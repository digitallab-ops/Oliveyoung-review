"""
OliveYoung Insight Slack Bot
OpenAI function calling + MCP 서버 연동 (스트리밍 + 세션 재사용)

환경변수:
  SLACK_BOT_TOKEN   xoxb-...
  SLACK_APP_TOKEN   xapp-... (Socket Mode)
  OPENAI_API_KEY    sk-...
  MCP_SERVER_URL    https://oliveyoung-review.vercel.app/api/mcp (기본값)
  MCP_API_KEY       Bearer 인증 키 (없으면 생략)
"""
import os
import re
import json
import time
import asyncio
import logging
from collections import deque
from typing import AsyncGenerator

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from openai import AsyncOpenAI
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MCP_URL        = os.environ.get("MCP_SERVER_URL", "https://oliveyoung-review.vercel.app/api/mcp")
MCP_API_KEY    = os.environ.get("MCP_API_KEY", "")
HISTORY_LEN    = 10
STREAM_INTERVAL = 1.0  # Slack chat.update 호출 간격 (초) — Tier3 rate limit 고려

app           = AsyncApp(token=os.environ["SLACK_BOT_TOKEN"])
openai_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

_tools_cache: list | None = None
_user_history: dict[str, deque] = {}

SYSTEM = (
    "당신은 셀퓨전씨 올리브영 인사이트 어시스턴트입니다. "
    "올리브영 판매 데이터, 리뷰, 시장 순위를 분석해서 한국어로 답변하세요.\n\n"

    "답변 포맷 규칙 (Slack mrkdwn):\n"
    "- 제목/구분은 *굵게* 사용\n"
    "- 순위 목록은 숫자+점 형식: `1. 상품명 — X위`\n"
    "- 핵심 수치는 *숫자* 로 강조\n"
    "- 섹션 구분은 빈 줄로\n"
    "- 불필요한 서론 없이 바로 본론\n"
    "- 마지막에 한 줄 인사이트 요약 (→ 로 시작)\n\n"

    "데이터 해석 규칙:\n"
    "- 자사 브랜드는 *셀퓨전씨(CellFusionC)* 단 하나입니다.\n"
    "- 툴 결과 상품명에 [자사] 태그가 붙은 것만 셀퓨전씨 상품입니다.\n"
    "- [경쟁사] 태그가 붙은 상품은 절대 자사 상품으로 언급하지 마세요.\n"
    "- 자사 상품 질문인데 [자사] 태그 상품이 없으면 '현재 해당 카테고리 Top 20에 자사 상품이 없습니다'로 답하세요.\n\n"

    "툴 사용 가이드:\n"
    "- 자사 제품 순위 질문 → get_today_ranking 사용\n"
    "- 시장 전체·카테고리·경쟁사 순위 질문 → get_market_rankings 사용\n\n"

    "올리브영 카테고리 매핑:\n"
    "- 선크림·선케어·자외선차단제·썬 → 선케어\n"
    "- 스킨·토너·에센스·세럼·앰플·로션·크림 → 스킨케어\n"
    "- 클렌징·세안 → 클렌징\n"
    "- 마스크팩·팩 → 마스크팩\n"
    "- 바디로션·바디크림·바디 → 바디케어\n"
    "- 더모·더마 → 더모 코스메틱\n"
    "- 남성·맨즈 → 맨즈에딧\n"
    "- 전체·전카테고리 → 전체"
)

_INTENT_SYSTEM = (
    "사용자 질문이 '셀퓨전씨 자사 제품'에 관한 것이면 'own'으로만, "
    "시장 전체나 경쟁사에 관한 것이면 'market'으로만 답하세요. "
    "다른 텍스트는 출력하지 마세요."
)
_FALLBACK_OWN_KW = ("우리", "자사", "셀퓨전씨")


# ── 유틸 ──────────────────────────────────────────────

def _headers() -> dict:
    return {"Authorization": f"Bearer {MCP_API_KEY}"} if MCP_API_KEY else {}


def _to_openai_tool(t) -> dict:
    return {
        "type": "function",
        "function": {
            "name": t.name,
            "description": t.description or "",
            "parameters": t.inputSchema or {"type": "object", "properties": {}},
        },
    }


async def _classify_intent(text: str) -> bool:
    """True = 자사 제품 쿼리. LLM 분류, 실패 시 키워드 폴백."""
    try:
        resp = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _INTENT_SYSTEM},
                {"role": "user", "content": text},
            ],
            max_tokens=5,
            temperature=0,
        )
        result = resp.choices[0].message.content.strip().lower()
        log.info("인텐트: '%s' → %s", text[:30], result)
        return result.startswith("own")
    except Exception as e:
        log.warning("인텐트 분류 실패, 키워드 폴백: %s", e)
        return any(kw in text for kw in _FALLBACK_OWN_KW)


def _annotate_result(content: str) -> str:
    """모든 툴 결과 상품명에 [자사] / [경쟁사] 태그 추가."""
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return content

    name_keys = ("goods_name", "name", "product_name")

    def tag(item: dict) -> dict:
        if not isinstance(item, dict) or "is_ours" not in item:
            return item
        label = "[자사]" if item.get("is_ours") else "[경쟁사]"
        item = dict(item)
        for k in name_keys:
            if k in item:
                item[k] = f"{label} {item[k]}"
                break
        return item

    if isinstance(data, list):
        return json.dumps([tag(i) for i in data], ensure_ascii=False)
    if isinstance(data, dict):
        for key in ("items", "products", "rankings", "data", "results"):
            if isinstance(data.get(key), list):
                data = dict(data)
                data[key] = [tag(i) for i in data[key]]
                return json.dumps(data, ensure_ascii=False)
    return content


def _filter_ours(content: str) -> str:
    """is_ours=false 항목 제거 — 자사 쿼리 확정 시에만 호출."""
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return content

    def do_filter(arr):
        ours = [i for i in arr if not isinstance(i, dict) or i.get("is_ours")]
        return ours, len(arr)

    if isinstance(data, list) and data and isinstance(data[0], dict) and "is_ours" in data[0]:
        ours, total = do_filter(data)
        if not ours:
            return '{"message": "현재 해당 카테고리 Top 20에 셀퓨전씨 자사 상품이 없습니다."}'
        return json.dumps(ours, ensure_ascii=False) + f"\n[자사 필터: {len(ours)}/{total}]"

    if isinstance(data, dict):
        for key in ("items", "products", "rankings", "data", "results"):
            arr = data.get(key)
            if isinstance(arr, list) and arr and isinstance(arr[0], dict) and "is_ours" in arr[0]:
                ours, total = do_filter(arr)
                if not ours:
                    return '{"message": "현재 해당 카테고리 Top 20에 셀퓨전씨 자사 상품이 없습니다."}'
                data = dict(data)
                data[key] = ours
                return json.dumps(data, ensure_ascii=False) + f"\n[자사 필터: {len(ours)}/{total}]"
    return content


def _get_history(user_id: str) -> list:
    if user_id not in _user_history:
        _user_history[user_id] = deque(maxlen=HISTORY_LEN)
    return list(_user_history[user_id])


def _add_history(user_id: str, role: str, content: str):
    if user_id not in _user_history:
        _user_history[user_id] = deque(maxlen=HISTORY_LEN)
    _user_history[user_id].append({"role": role, "content": content})


# ── 핵심 로직 ──────────────────────────────────────────

async def answer_stream(user_id: str, user_text: str) -> AsyncGenerator:
    """
    Async generator. 각 단계를 스트리밍으로 처리.
    yields: ("chunk", partial_text)  — 답변 생성 중 (Slack 메시지 실시간 업데이트용)
            ("done",  full_text)     — 완료
            ("error", message)       — 오류
    """
    global _tools_cache

    # 인텐트 분류를 MCP 연결과 병렬로 시작
    intent_task = asyncio.create_task(_classify_intent(user_text))
    history  = _get_history(user_id)
    messages = [{"role": "system", "content": SYSTEM}] + history + [{"role": "user", "content": user_text}]

    try:
        async with streamablehttp_client(MCP_URL, headers=_headers()) as (r, w, _):
            async with ClientSession(r, w) as mcp:
                await mcp.initialize()

                # MCP 연결 완료 → 인텐트 결과 대기 (이미 끝났을 가능성 높음)
                ours_query = await intent_task

                # 툴 목록 캐시 (세션 재사용 — 연결 1회로 list + call 처리)
                if _tools_cache is None:
                    _tools_cache = (await mcp.list_tools()).tools
                    log.info("툴 목록 캐싱: %d개", len(_tools_cache))
                oai_tools = [_to_openai_tool(t) for t in _tools_cache]

                final_answer = None

                for _ in range(6):
                    # ── OpenAI 스트리밍 호출 ──
                    stream = await openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=messages,
                        tools=oai_tools,
                        tool_choice="auto",
                        stream=True,
                        max_tokens=1500,
                    )

                    tool_calls_buf: list[dict] = []
                    content_buf = ""
                    saw_tool_calls = False

                    async for chunk in stream:
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta

                        # 툴 호출 델타 누적
                        if delta.tool_calls:
                            saw_tool_calls = True
                            for tc_d in delta.tool_calls:
                                idx = tc_d.index
                                while idx >= len(tool_calls_buf):
                                    tool_calls_buf.append({"id": "", "name": "", "arguments": ""})
                                if tc_d.id:
                                    tool_calls_buf[idx]["id"] = tc_d.id
                                if tc_d.function:
                                    if tc_d.function.name:
                                        tool_calls_buf[idx]["name"] += tc_d.function.name
                                    if tc_d.function.arguments:
                                        tool_calls_buf[idx]["arguments"] += tc_d.function.arguments

                        # 텍스트 델타 → 툴 호출 라운드가 아닐 때만 스트리밍
                        if delta.content and not saw_tool_calls:
                            content_buf += delta.content
                            yield ("chunk", content_buf)

                    # ── 툴 호출 없음 = 최종 답변 완성 ──
                    if not tool_calls_buf:
                        final_answer = content_buf or "답변을 생성하지 못했습니다."
                        break

                    # ── 툴 호출 처리 (같은 MCP 세션 재사용) ──
                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {"id": tc["id"], "type": "function",
                             "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                            for tc in tool_calls_buf
                        ],
                    })

                    for tc in tool_calls_buf:
                        try:
                            args   = json.loads(tc["arguments"] or "{}")
                            result = await mcp.call_tool(tc["name"], args)
                            rc = "\n".join(
                                c.text if hasattr(c, "text") else str(c)
                                for c in result.content
                            )
                            if ours_query:
                                rc = _filter_ours(rc)
                            rc = _annotate_result(rc)
                            log.info("툴 처리 (%s) ours=%s", tc["name"], ours_query)
                        except Exception as e:
                            rc = f"[오류: {e}]"
                            log.error("툴 호출 실패 %s: %s", tc["name"], e)
                        messages.append({"role": "tool", "tool_call_id": tc["id"], "content": rc})

                if final_answer is None:
                    final_answer = "처리 중 오류가 발생했습니다."

                _add_history(user_id, "user", user_text)
                _add_history(user_id, "assistant", final_answer)
                yield ("done", final_answer)

    except Exception as e:
        log.error("answer_stream 실패: %s", e)
        if not intent_task.done():
            intent_task.cancel()
        yield ("error", "데이터 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")


# ── Slack 메시지 스트리밍 헬퍼 ─────────────────────────

async def _stream_to_slack(gen: AsyncGenerator, client, channel: str, msg_ts: str, fallback_say):
    """answer_stream generator를 받아 Slack 메시지를 실시간 업데이트."""
    last_update = 0.0
    final_text  = ""

    async for kind, payload in gen:
        if kind == "chunk" and msg_ts:
            now = time.monotonic()
            if now - last_update >= STREAM_INTERVAL:
                try:
                    await client.chat_update(channel=channel, ts=msg_ts, text=payload + " ▌")
                    last_update = now
                except Exception:
                    pass  # rate limit 등 — 다음 인터벌에 재시도
        elif kind in ("done", "error"):
            final_text = payload

    if final_text:
        if msg_ts:
            try:
                await client.chat_update(channel=channel, ts=msg_ts, text=final_text)
                return
            except Exception:
                pass
        await fallback_say(final_text)


# ── 이벤트 핸들러 ──────────────────────────────────────

@app.event("app_mention")
async def on_mention(event, say, client):
    text    = re.sub(r"<@\w+>", "", event.get("text", "")).strip()
    user_id = event.get("user", "unknown")
    channel = event["channel"]
    thread_ts = event["ts"]

    if not text:
        await say("무엇이 궁금하신가요?", thread_ts=thread_ts)
        return

    resp   = await say(":mag: 조회 중...", thread_ts=thread_ts)
    msg_ts = (resp.get("message") or {}).get("ts") or resp.get("ts")

    await _stream_to_slack(
        answer_stream(user_id, text),
        client, channel, msg_ts,
        fallback_say=lambda t: say(t, thread_ts=thread_ts),
    )


@app.event("message")
async def on_dm(event, say, client):
    if event.get("channel_type") != "im" or event.get("bot_id"):
        return
    text    = event.get("text", "").strip()
    user_id = event.get("user", "unknown")
    channel = event["channel"]

    if not text:
        return

    resp   = await say(":mag: 조회 중...")
    msg_ts = (resp.get("message") or {}).get("ts") or resp.get("ts")

    await _stream_to_slack(
        answer_stream(user_id, text),
        client, channel, msg_ts,
        fallback_say=say,
    )


# ── 메인 ──────────────────────────────────────────────

async def _main():
    handler = AsyncSocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    log.info("Slack 봇 시작 (Socket Mode)")
    await handler.start_async()

if __name__ == "__main__":
    asyncio.run(_main())

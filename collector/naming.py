"""상품명 정리.

수집기가 목록에서 이름을 읽을 때 `.tx_name` 대신 브랜드까지 품은 상위
요소가 잡히는 경우가 있다. `get_text()` 가 자식 텍스트를 전부 이어붙이므로
브랜드가 두 번 들어간다. 실측(2026-11-02) 기준:

    products         2,074/2,229 (93%)
    market_rankings  2,892,848/2,990,286 (97%)
    promo_items      24,710/31,614 (78%)

세 가지 모양이 관찰된다.

    아누아아누아 어성초 센텔라...          공백 없이 반복
    한율[NEW] 한율 쑥판텐...              사이에 기획 태그가 낀다
    셀퓨전씨 셀퓨전씨 레이저...            공백으로 띄워 반복

자사 상품은 `[태그] 셀퓨전씨 ...` 형태라 브랜드가 한 번뿐이다. 그래서 화면에서
한참 눈에 띄지 않았다 — 자사만 보면 멀쩡해 보인다.

마크업을 추측해 선택자를 고치는 대신 저장 직전에 한 번 편다. 선택자는 또
바뀌지만 '브랜드가 앞에 두 번'이라는 모양은 바뀌지 않는다.
"""
from __future__ import annotations

import re

# 브랜드[태그] 브랜드 ...  또는  브랜드 브랜드 ...
_REPEAT = re.compile(r"^(\S+?)(\[[^\]]*\])?\s+\1(?=\s|$)")


def dedupe_brand(name: str | None) -> str:
    """앞에 두 번 붙은 브랜드명을 한 번으로 줄인다. 아니면 그대로 돌려준다."""
    s = (name or "").strip()
    if not s:
        return s

    m = _REPEAT.match(s)
    if m:
        head = m.group(1) + (m.group(2) or "")
        rest = s[m.end():].lstrip()
        return f"{head} {rest}".strip() if rest else head

    first = s.split()[0]
    h = len(first) // 2
    if len(first) >= 4 and len(first) % 2 == 0 and first[:h] == first[h:]:
        return (first[:h] + s[len(first):]).strip()

    return s

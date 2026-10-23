"""대시보드 상세페이지 탭의 데이터를 다시 만든다.

디자인(index.html · app.js)은 거의 안 바뀌고 데이터는 2주마다 바뀐다.
그래서 이 모듈은 **데이터만** 건드린다 — web/public/detail/ 의
data.json 과 strips/ 를 갈아끼우고 index.html·app.js 는 손대지 않는다.

산출 순서가 있다. export_certs 는 export_extra 가 쓴 extra.json 을 열어
certs 블록만 덮어쓰므로 반드시 뒤에 와야 한다.

    python -m collector.detail_page_webdata
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import runpy
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "detail")
WORK = os.environ.setdefault("DETAIL_EXPORT_DIR", os.path.join(ROOT, "exports", "_webdata"))

# 아티팩트는 외부 리소스를 못 받아 이미지를 통째로 안고 있어야 했다.
# 대시보드는 같은 출처에서 파일을 서빙하므로 그럴 이유가 없다 — 3MB 가
# data.json 에서 빠지고 <img> 가 필요할 때만 받아온다.
DATA_URI = re.compile(r"data:image/(?P<ext>[a-zA-Z]+);base64,(?P<b64>[A-Za-z0-9+/=]+)")

# build_thumbs 가 썸네일을 만들고 export_v2 가 그걸 읽는다. 순서가 있다.
STEPS = ["build_thumbs", "export_gen", "export_extra", "export_certs", "export_v2"]


def _run_steps() -> None:
    for name in STEPS:
        print(f"\n── {name} ──", flush=True)
        runpy.run_module(f"collector.webdata.{name}", run_name="__main__")


def _split_strips(payload: str) -> tuple[str, int, int]:
    d = os.path.join(OUT, "strips")
    os.makedirs(d, exist_ok=True)
    seen: dict[str, str] = {}
    saved = [0]

    def repl(m):
        b64 = m.group("b64")
        key = hashlib.sha1(b64.encode()).hexdigest()[:16]
        if key not in seen:
            ext = m.group("ext").lower()
            ext = "jpg" if ext in ("jpeg", "jpg") else ext
            try:
                raw = base64.b64decode(b64)
            except Exception:
                return m.group(0)
            with open(os.path.join(d, f"{key}.{ext}"), "wb") as f:
                f.write(raw)
            seen[key] = f"strips/{key}.{ext}"
            saved[0] += len(raw)
        return seen[key]

    return DATA_URI.sub(repl, payload), len(seen), saved[0]


def _load(name: str) -> dict:
    p = os.path.join(WORK, name)
    if not os.path.exists(p):
        raise SystemExit(f"{name} 이 없다 — 앞 단계가 실패했다: {p}")
    return json.loads(io.open(p, encoding="utf-8").read())


def run() -> None:
    if not os.path.isdir(OUT):
        raise SystemExit(f"{OUT} 가 없다. detail_page_webexport 로 "
                         f"index.html·app.js 를 먼저 만들어라")

    _run_steps()

    gen = _load("gen.json")
    extra = _load("extra.json")
    v2 = _load("v2.json")

    # build 과정에서 섞이면 화면이 통째로 빈다. 키 이름은 app.js 가 읽는 그대로다.
    payload = json.dumps({
        "gen": gen, "extra": extra,
        "meta": v2["meta"], "dissect": v2["dissect"], "lines": v2["lines"],
    }, ensure_ascii=False)

    payload, n_img, n_bytes = _split_strips(payload)

    p = os.path.join(OUT, "data.json")
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(payload)

    m = gen.get("meta", {})
    print(f"\n=== 완료 ===")
    print(f"  data.json  {os.path.getsize(p)/1024:,.0f} KB")
    print(f"  strips/    {n_img}개 · {n_bytes/1024/1024:.2f} MB")
    print(f"  상품 {m.get('nProd', '?')}개 · 섹션 {m.get('nSec', '?'):,}개 "
          f"· 유형 {len(gen.get('types', {}))}개")
    print(f"\n→ 배포하려면 web/public/detail/ 을 커밋하고 푸시해라")


if __name__ == "__main__":
    sys.exit(run())

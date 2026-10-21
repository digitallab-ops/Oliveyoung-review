"""발행된 아티팩트를 대시보드 탭으로 옮긴다.

왜 이런 모양인가:
  생성기의 '디자인'은 claude.ai 아티팩트에서 만들어진다. '데이터'는 이 DB 에서
  나온다. 둘을 한 파일(3.9MB)에 말아 넣은 게 아티팩트인데, 대시보드에 그대로
  올리면 탭 하나가 3.9MB 가 된다. 그래서 셋으로 가른다.

    index.html   디자인 + 로더          (바뀔 일이 드물다)
    app.js       화면 로직              (바뀔 일이 드물다)
    data.json    집계 결과              (2주 주기로 갈아끼운다)
    strips/*.jpg 상세페이지 썸네일       (3.05MB → 파일로 뺀다)

  app.js 는 손대지 않는다. 아티팩트가 만든 코드를 그대로 쓰되, 데이터를
  읽는 지점(<script id="payload">)만 로더가 미리 채워 준다.

claude 런타임:
  아티팩트 안에서는 window.claude 가 있어 AI 문구 생성과 파일 저장이 된다.
  대시보드엔 없다. 그냥 두면 `claude.use(...)` 에서 ReferenceError 가 나고
  그 아래 스크립트가 통째로 죽는다(실제로 이 함정에 한 번 빠졌다).
  그래서 로더가 대역을 깔아 준다.
    sample    -> null  : AI 버튼이 스스로 숨는다 (body.no-ai)
    downloads -> 실제 Blob 저장 : 아티팩트와 달리 여기선 진짜 내려받기가 된다

실행:
    python -m collector.detail_page_webexport --src <발행본.html>
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "public", "detail")

PAYLOAD_OPEN = '<script type="application/json" id="payload">'
DATA_URI = re.compile(r'data:image/(?P<ext>[a-zA-Z]+);base64,(?P<b64>[A-Za-z0-9+/=]+)')

# 로더. app.js 보다 먼저 돌아서 (1) claude 대역을 깔고 (2) 데이터를 채운 뒤
# (3) app.js 를 붙인다. app.js 는 자기가 늦게 실행된다는 걸 알 필요가 없다.
LOADER = '''<script type="application/json" id="payload"></script>
<script>
(function(){
  // 아티팩트 런타임 대역. 없으면 app.js 가 claude 를 읽다가 통째로 죽는다.
  if (!window.claude) window.claude = { use: function(name){
    if (name !== 'downloads') return Promise.resolve(null);   // AI 는 숨긴다
    return Promise.resolve({ save: function(o){
      try {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([o.data], {type:'text/plain;charset=utf-8'}));
        a.download = o.filename || 'download.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
        return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    }});
  }};

  // 부모(대시보드)에게 높이를 알려 iframe 을 늘리게 한다
  function postH(){
    try {
      if (window.parent === window) return;
      window.parent.postMessage(
        {type:'detailTabHeight', h: document.documentElement.scrollHeight}, '*');
    } catch (e) {}
  }
  var t; new MutationObserver(function(){ clearTimeout(t); t = setTimeout(postH, 80); })
    .observe(document.documentElement, {subtree:true, childList:true, attributes:true});
  window.addEventListener('resize', postH);

  fetch('data.json?v=__VER__').then(function(r){
    if (!r.ok) throw new Error(r.status);
    return r.text();
  }).then(function(txt){
    document.getElementById('payload').textContent = txt;
    var s = document.createElement('script');
    s.src = 'app.js?v=__VER__';
    s.onload = function(){ setTimeout(postH, 60); };
    document.body.appendChild(s);
  }).catch(function(e){
    document.getElementById('payload').insertAdjacentHTML('afterend',
      '<p style="padding:24px;color:#b2421a">데이터를 불러오지 못했습니다 (' +
      e.message + '). 수집 파이프라인이 data.json 을 만들었는지 확인하세요.</p>');
  });
})();
</script>'''


def split_strips(payload: str, outdir: str) -> tuple[str, int, int]:
    """base64 이미지를 파일로 빼고 상대 경로로 바꾼다.

    아티팩트는 외부 리소스를 못 받아서 이미지를 통째로 안고 있어야 했다.
    대시보드는 같은 출처에서 파일을 서빙하므로 그럴 이유가 없다 — 3.05MB 가
    HTML 에서 빠지고, <img> 가 필요할 때만 받아온다.
    """
    d = os.path.join(outdir, "strips")
    os.makedirs(d, exist_ok=True)
    seen: dict[str, str] = {}
    saved = [0]

    def repl(m):
        b64 = m.group("b64")
        key = hashlib.sha1(b64.encode()).hexdigest()[:16]
        if key not in seen:
            ext = "jpg" if m.group("ext").lower() in ("jpeg", "jpg") else m.group("ext").lower()
            name = f"{key}.{ext}"
            try:
                raw = base64.b64decode(b64)
            except Exception:
                return m.group(0)            # 못 풀면 그대로 둔다
            with open(os.path.join(d, name), "wb") as f:
                f.write(raw)
            seen[key] = "strips/" + name
            saved[0] += len(raw)
        return seen[key]

    out = DATA_URI.sub(repl, payload)
    return out, len(seen), saved[0]


def run(src: str, ver: str) -> None:
    html = io.open(src, encoding="utf-8").read()

    i = html.index(PAYLOAD_OPEN)
    j = html.index("</script>", i)
    payload = html[i + len(PAYLOAD_OPEN):j]

    # payload 뒤의 <script> ... 마지막 </script> 가 화면 로직이다
    k = html.index("<script>", j)
    m = html.rindex("</script>")
    app = html[k + len("<script>"):m]

    os.makedirs(OUT, exist_ok=True)
    payload, n_img, n_bytes = split_strips(payload, OUT)

    shell = html[:i] + LOADER.replace("__VER__", ver) + html[m + len("</script>"):]
    # 아티팩트 전용 메타는 떼어낸다
    shell = shell.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")

    for name, body in (("index.html", shell), ("app.js", app), ("data.json", payload)):
        with io.open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        print(f"  {name:<12} {len(body.encode('utf-8'))/1024:>9,.0f} KB")
    print(f"  strips/      {n_img}개 · {n_bytes/1024/1024:.2f}MB")
    print(f"\n→ {OUT}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="발행된 아티팩트 HTML 경로")
    ap.add_argument("--ver", default="", help="캐시 무효화용 문자열 (보통 날짜)")
    a = ap.parse_args()
    if not a.ver:
        import datetime
        a.ver = datetime.date.today().isoformat()
    run(a.src, a.ver)


if __name__ == "__main__":
    main()

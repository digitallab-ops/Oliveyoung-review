"""해부 대상 4개 상품의 썸네일을 만든다 (export_v2 가 읽는다).

스크래치패드에서 레포로 옮긴 것 — 2주 주기 작업이 돌려야 하므로
임시 폴더에 두면 안 된다. 경로만 레포 기준으로 바꿨다.
"""
"""해부 대상 4개 상품의 이미지를 아티팩트용 base64로 줄인다."""
import sys, os, io, json, base64
import os as _os
sys.path.insert(0, r'C:\oliveyounginsight\Ollive0-CellFusionC-Review')
from dotenv import load_dotenv
load_dotenv(r'C:\oliveyounginsight\Ollive0-CellFusionC-Review\.env')
from db.schema import get_conn
from PIL import Image

TARGETS = [
    ('A000000215102', '전형'),   # 자리표시자 — 아래에서 실제 goods_no 로 교체
]
W = 360          # 가로 폭
Q = 72           # JPEG 품질
MAX_H = 3000     # 세로가 너무 긴 통짜 이미지는 잘라낸다
_R = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
IMG_ROOT = _os.path.join(_R, 'exports', 'detail_pages')
_D = _os.environ.get('DETAIL_EXPORT_DIR') or _os.path.join(_R, 'exports', '_webdata')
_os.makedirs(_D, exist_ok=True)
OUT = _os.path.join(_D, 'thumbs.json')

# goods_no 로 직접 지정한다. 표시용 이름은 [...] 를 떼어낸 형태라 원본과 다르다
PICKS = [
    ('A000000223207', '전형',   'AHC 마스터즈 아쿠아리치 선크림'),
    ('A000000218813', '자사',   '셀퓨전씨 아쿠아티카 쿨링 썬스크린'),
    ('A000000263555', '장문형', '구달 맑은 어성초 진정 수분 선크림'),
    ('A000000232884', '미니멀', '어테이션 익모초 유브이 톤업 선스크린'),
]

conn = get_conn(); conn.autocommit = True
cur = conn.cursor()
cur.execute("SELECT goods_no, goods_name, is_competitor FROM products WHERE goods_no = ANY(%s)",
            ([g for g, _, _ in PICKS],))
meta = {dict(r)['goods_no']: dict(r) for r in cur.fetchall()}

picked = []
for gno, tag, label in PICKS:
    m = meta.get(gno)
    assert m, f'상품 없음: {gno}'
    picked.append((gno, label, tag, not m['is_competitor']))
    print(f"{tag:<5} {gno}  {label}")

out, total = {}, 0
for gno, name, tag, ours in picked:
    d = os.path.join(IMG_ROOT, gno)
    files = sorted(f for f in os.listdir(d) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    imgs = []
    for i, f in enumerate(files, 1):
        try:
            im = Image.open(os.path.join(d, f)).convert('RGB')
        except Exception as e:
            print(f'  {gno}/{f} 열기 실패: {e}'); continue
        w, h = im.size
        nh = max(1, round(h * W / w))
        if nh > MAX_H:
            im = im.crop((0, 0, w, round(h * MAX_H / nh)))
            w, h = im.size
            nh = MAX_H
        im = im.resize((W, nh), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=Q, optimize=True, progressive=True)
        b = buf.getvalue()
        total += len(b)
        imgs.append({'seq': i, 'h': nh,
                     'd': 'data:image/jpeg;base64,' + base64.b64encode(b).decode()})
    out[gno] = {'name': name, 'tag': tag, 'ours': ours, 'imgs': imgs}
    print(f'  → {len(imgs)}장, 누적 {total/1024/1024:.1f}MB')

io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False))
print(f'\n저장 {OUT}  {os.path.getsize(OUT)/1024/1024:.1f}MB')
conn.close()

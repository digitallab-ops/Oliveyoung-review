"""생성기 데이터 산출 — 스크래치패드에서 레포로 옮긴 것.

2주 주기 작업이 이 코드를 돌려야 하는데 임시 폴더에 있으면 세션이 끝날 때
사라진다. 출력 경로만 바꾸고 나머지는 그대로 옮겼다.
"""
"""아티팩트 v2 데이터 — 페이지 해부 + 문구 사전."""
import sys, os, io, json
from collections import Counter, defaultdict
sys.path.insert(0, r'C:\oliveyounginsight\Ollive0-CellFusionC-Review')
from dotenv import load_dotenv
load_dotenv(r'C:\oliveyounginsight\Ollive0-CellFusionC-Review\.env')
from db.schema import get_conn
from collector.detail_page_library import _load, _brand, _clean, _is_lettering, _norm

import os as _os
D = _os.environ.get('DETAIL_EXPORT_DIR') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
    'exports', '_webdata')
_os.makedirs(D, exist_ok=True)
thumbs = json.loads(io.open(os.path.join(D, 'thumbs.json'), encoding='utf-8').read())

conn = get_conn(); conn.autocommit = True
rows = _load(conn)
cur = conn.cursor()

def _zone_ev(secs):
    """구간별 근거 비율. secs 는 DB 행이라 키가 'evidence' 다."""
    out = []
    for z, lo, hi in [('초', 0, 20), ('전', 20, 40), ('중', 40, 60), ('후', 60, 80), ('말', 80, 101)]:
        g = [s for s in secs if s['scroll_pct'] is not None
             and lo <= float(s['scroll_pct']) < hi]
        ev = round(sum(1 for s in g if s['evidence'] and s['evidence'] != '없음') * 100 / len(g)) if g else 0
        out.append({'z': z, 'ev': ev, 'n': len(g)})
    return out


# ── 1. 해부 ────────────────────────────────────────────────
# 섹션의 scroll_pct 와 이미지 누적 높이를 맞춰 '이 띠가 어느 섹션인가'를 정한다
dissect = []
for gno, t in thumbs.items():
    cur.execute("""SELECT seq, height FROM detail_page_images
                   WHERE goods_no=%s ORDER BY seq""", (gno,))
    heights = [dict(r)['height'] or 1 for r in cur.fetchall()]
    # 썸네일 장수와 DB 행 수가 어긋나면 썸네일 쪽 높이를 쓴다
    if len(heights) != len(t['imgs']):
        heights = [i['h'] for i in t['imgs']]
    total = sum(heights) or 1
    acc, bands = 0, []
    for h, im in zip(heights, t['imgs']):
        bands.append({'a': acc * 100 / total, 'b': (acc + h) * 100 / total})
        acc += h

    secs = sorted([r for r in rows if r['goods_no'] == gno], key=lambda x: x['seq'])
    # 섹션 하나는 이미지 하나에만 붙인다. 경계에 걸치면 중복으로 세어진다
    buckets = [[] for _ in bands]
    for sec in secs:
        if sec['scroll_pct'] is None:
            continue
        pct = float(sec['scroll_pct'])
        idx = next((i for i, bd in enumerate(bands) if bd['a'] <= pct < bd['b']), None)
        if idx is None:                      # 100% 등 마지막 경계
            idx = len(bands) - 1
        buckets[idx].append(sec)
    for im, bucket in zip(t['imgs'], buckets):
        im['secs'] = [{
            'role': s['role'], 'copy': s['copy_type'], 'vis': s['visual'],
            'ev': s['evidence'] if s['evidence'] != '없음' else None,
            'h': (s['headline'] or '')[:70],
        } for s in bucket]

    ev = sum(1 for s in secs if s['evidence'] and s['evidence'] != '없음')
    dissect.append({
        'gno': gno, 'name': t['name'], 'tag': t['tag'], 'ours': t['ours'],
        'nSec': len(secs), 'nImg': len(t['imgs']),
        'evRate': round(ev * 100 / len(secs)) if secs else 0,
        'roles': len({s['role'] for s in secs}),
        'height': sum(i['h'] for i in t['imgs']),
        'imgs': t['imgs'],
        'curve': _zone_ev(secs),
    })
dissect.sort(key=lambda x: -x['nSec'])

# ── 2. 문구 사전 ───────────────────────────────────────────
def zone(p):
    if p is None: return '?'
    return ('초반', '전반', '중반', '후반', '마무리')[min(int(float(p) // 20), 4)]

seen, lines = set(), []
for r in rows:
    h = (r['headline'] or '').strip()
    if not h or len(h) < 5 or _is_lettering(h):
        continue
    k = _norm(h)
    if k in seen:
        continue
    seen.add(k)
    lines.append({
        't': h[:110], 'r': r['role'], 'c': r['copy_type'], 'v': r['visual'],
        'e': r['evidence'] if r['evidence'] != '없음' else '',
        'b': _brand(r['goods_name']), 'p': r['ptype'], 'z': zone(r['scroll_pct']),
        'n': 1 if r['has_number'] else 0,
        'o': 0 if r['is_competitor'] else 1,
    })
lines.sort(key=lambda x: (x['r'], x['z']))

roles = [a for a, _ in Counter(l['r'] for l in lines).most_common()]
types = [a for a, _ in Counter(l['p'] for l in lines).most_common()]

# ── 3. 전체 요약 (맥락용, 최소한으로) ──────────────────────
n_prod = len({r['goods_no'] for r in rows})
curve = []
for z, lo, hi in [('초반', 0, 20), ('전반', 20, 40), ('중반', 40, 60), ('후반', 60, 80), ('마무리', 80, 101)]:
    g = [r for r in rows if r['scroll_pct'] is not None and lo <= float(r['scroll_pct']) < hi]
    if not g: continue
    curve.append({'z': z,
                  'ev': sum(1 for r in g if r['evidence'] and r['evidence'] != '없음') * 100 // len(g),
                  'roles': [[a, b * 100 // len(g)] for a, b in Counter(r['role'] for r in g).most_common(3)]})

meta = {'nProd': n_prod, 'nSec': len(rows), 'nLines': len(lines),
        'roles': roles, 'types': types, 'curve': curve}

out = os.path.join(D, 'v2.json')
io.open(out, 'w', encoding='utf-8').write(
    json.dumps({'meta': meta, 'dissect': dissect, 'lines': lines}, ensure_ascii=False))
print(f'저장 {out}  {os.path.getsize(out)/1024/1024:.1f}MB')
print(f'해부 {len(dissect)}개 · 문구 {len(lines):,}개 · 역할 {len(roles)}종')
for d in dissect:
    lab = sum(len(i['secs']) for i in d['imgs'])
    print(f"  {d['tag']:<4} {d['name'][:30]:<32} 이미지{d['nImg']:>3} 섹션{d['nSec']:>3} 매핑{lab:>3} 근거{d['evRate']}%")
conn.close()

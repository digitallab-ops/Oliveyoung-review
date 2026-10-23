"""생성기 데이터 산출 — 스크래치패드에서 레포로 옮긴 것.

2주 주기 작업이 이 코드를 돌려야 하는데 임시 폴더에 있으면 세션이 끝날 때
사라진다. 출력 경로만 바꾸고 나머지는 그대로 옮겼다.
"""
"""초안 생성기용 데이터 — 유형별 구성 칸 + 칸마다 붙일 실제 사례."""
import sys, os, io, json, statistics
from collections import Counter, defaultdict
sys.path.insert(0, r'C:\oliveyounginsight\Ollive0-CellFusionC-Review')
from dotenv import load_dotenv
load_dotenv(r'C:\oliveyounginsight\Ollive0-CellFusionC-Review\.env')
from db.schema import get_conn
from collector.detail_page_library import (
    _load, _appeal_terms, _brand, _clean, _is_lettering, _norm)

import os as _os
D = _os.environ.get('DETAIL_EXPORT_DIR') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
    'exports', '_webdata')
_os.makedirs(D, exist_ok=True)
MIN_ADOPT = 25.0      # 이 아래는 업계 관행이 아니라 한두 브랜드의 특이사항
MIN_EV = 15.0
MIN_PROD = 5

# 역할이 어떤 근거를 요구하는가 — 보유 근거에 따라 칸을 조정하기 위한 매핑
NEEDS = {
    '임상인증': 'clinical', '실적소구': 'sales', '후기소셜': 'review',
    '비교': 'beforeafter', '성분': 'ingredient', '기획증정': 'promo',
}

conn = get_conn(); conn.autocommit = True
rows = _load(conn)


def slots(rs, n_prod):
    by_role = defaultdict(list)
    for r in rs:
        by_role[r['role']].append(r)
    out = []
    for role, g in by_role.items():
        pos = [float(x['scroll_pct']) for x in g if x['scroll_pct'] is not None]
        if not pos:
            continue
        prods = {x['goods_no'] for x in g}
        adopt = len(prods) * 100 / n_prod
        if adopt < MIN_ADOPT or role in ('기타', '해당없음'):
            continue
        terms = _appeal_terms(g)
        ev_rate = sum(1 for x in g if x['evidence'] and x['evidence'] != '없음') * 100 / len(g)
        evc = Counter(x['evidence'] for x in g if x['evidence'] and x['evidence'] != '없음')
        cc = Counter(x['copy_type'] for x in g if x['copy_type'])
        vc = Counter(x['visual'] for x in g if x['visual'])
        tc = sum(cc.values()) or 1
        tv = sum(vc.values()) or 1

        # 사례 — 브랜드당 1개, 영문 레터링 제외, 소구어 점수 순
        score = dict(terms)
        ex, sb, st = [], set(), set()
        for x in sorted(g, key=lambda y: -sum(score.get(a, 0) for a in y['appeals'])):
            h = (x['headline'] or '').strip()
            b = _brand(x['goods_name'])
            if not h or len(h) < 6 or _is_lettering(h) or b in sb or _norm(h) in st:
                continue
            sb.add(b); st.add(_norm(h))
            ex.append({'t': h[:90], 'b': b, 'c': x['copy_type']})
            if len(ex) >= 5:
                break

        out.append({
            'role': role,
            'pos': round(statistics.median(pos)),
            'adopt': round(adopt),
            'per': round(len(g) / len(prods), 1),
            'copy': [[a, b * 100 // tc] for a, b in cc.most_common(2)],
            'vis': [[a, b * 100 // tv] for a, b in vc.most_common(2)],
            'evRate': round(ev_rate),
            'ev': ([[a, b * 100 // sum(evc.values())] for a, b in evc.most_common(2)]
                   if ev_rate >= MIN_EV and sum(evc.values()) >= 10 else None),
            'numRate': round(sum(1 for x in g if x['has_number']) * 100 / len(g)),
            'terms': [t for t, _ in terms.most_common(10)],
            'ex': ex,
            'needs': NEEDS.get(role),
        })
    out.sort(key=lambda x: x['pos'])
    return out


types = {}
by_type = defaultdict(list)
for r in rows:
    by_type[r['ptype']].append(r)

ALL_N = len({r['goods_no'] for r in rows})
types['전체'] = {
    'label': '전체 (유형 미정)', 'nProd': ALL_N,
    'medSec': round(statistics.median(
        [len([r for r in rows if r['goods_no'] == g])
         for g in {r['goods_no'] for r in rows}])),
    'slots': slots(rows, ALL_N),
}
for t, rs in sorted(by_type.items(), key=lambda x: -len({r['goods_no'] for r in x[1]})):
    n = len({r['goods_no'] for r in rs})
    if n < MIN_PROD or t == '기타':
        continue
    per = [len([r for r in rs if r['goods_no'] == g]) for g in {r['goods_no'] for r in rs}]
    types[t] = {'label': t, 'nProd': n, 'medSec': round(statistics.median(per)),
                'slots': slots(rs, n)}

# ── 간결한 근거 막대 ──
n_prod = ALL_N
adopt_bars = []
for role, _ in Counter(r['role'] for r in rows).most_common(8):
    np_ = len({r['goods_no'] for r in rows if r['role'] == role})
    adopt_bars.append({'k': role, 'v': round(np_ * 100 / n_prod)})

op = {r['goods_no'] for r in rows if not r['is_competitor']}
cp = {r['goods_no'] for r in rows if r['is_competitor']}
gap_bars = []
for key, vals in (('evidence', ['인증마크','판매실적','전후사진','후기인용']),
                  ('visual', ['모델컷','시연컷','그래프','비교표'])):
    for v in vals:
        o = len({r['goods_no'] for r in rows if r[key] == v and not r['is_competitor']})
        c = len({r['goods_no'] for r in rows if r[key] == v and r['is_competitor']})
        gap_bars.append({'k': v, 'our': round(o*100/len(op)), 'comp': round(c*100/len(cp))})
gap_bars.sort(key=lambda x: x['our'] - x['comp'])

type_bars = [{'k': k, 'v': v['medSec'], 'n': v['nProd']}
             for k, v in types.items() if k != '전체']

zone_bars = []
for z, lo, hi in [('초반',0,20),('전반',20,40),('중반',40,60),('후반',60,80),('마무리',80,101)]:
    g = [r for r in rows if r['scroll_pct'] is not None and lo <= float(r['scroll_pct']) < hi]
    if g:
        zone_bars.append({'k': z,
                          'v': round(sum(1 for r in g if r['evidence'] and r['evidence'] != '없음')*100/len(g))})

secs_per = [len([r for r in rows if r['goods_no'] == g]) for g in {r['goods_no'] for r in rows}]
meta = {
    'nProd': n_prod, 'nSec': len(rows),
    'secMed': round(statistics.median(secs_per)),
    'secMin': min(secs_per), 'secMax': max(secs_per),
    'adoptBars': adopt_bars, 'gapBars': gap_bars,
    'typeBars': type_bars, 'zoneBars': zone_bars,
}

out = {'meta': meta, 'types': types}
p = os.path.join(D, 'gen.json')
io.open(p, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False))
print(f'저장 {p}  {os.path.getsize(p)/1024:.0f}KB')
for k, v in types.items():
    print(f"  {k:<8} {v['nProd']:>3}개 상품 · 중앙 {v['medSec']:>3}섹션 · 칸 {len(v['slots'])}개")
print('\n전체 칸 순서:')
for s in types['전체']['slots']:
    need = f" [{s['needs']}]" if s['needs'] else ''
    print(f"  {s['pos']:>3}% {s['role']:<9} 채택{s['adopt']:>3}% 보통{s['per']}개 근거{s['evRate']:>3}%{need}")
conn.close()

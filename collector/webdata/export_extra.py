"""생성기 데이터 산출 — 스크래치패드에서 레포로 옮긴 것.

2주 주기 작업이 이 코드를 돌려야 하는데 임시 폴더에 있으면 세션이 끝날 때
사라진다. 출력 경로만 바꾸고 나머지는 그대로 옮겼다.
"""
"""생성기 추가분 — 인증마크 · 분류 기준 · 소구어 후보."""
import sys, os, io, json
from collections import Counter, defaultdict
sys.path.insert(0, r'C:\oliveyounginsight\Ollive0-CellFusionC-Review')
from dotenv import load_dotenv
load_dotenv(r'C:\oliveyounginsight\Ollive0-CellFusionC-Review\.env')
from db.schema import get_conn
from collector.detail_page_library import _load, _appeal_terms
from collector.detail_page_analyzer import ROLES, COPY_TYPES, VISUAL_TYPES, EVIDENCE_TYPES
from collector.detail_page_certs import _load as cert_load, group_of, norm, GROUPS

import os as _os
D = _os.environ.get('DETAIL_EXPORT_DIR') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
    'exports', '_webdata')
_os.makedirs(D, exist_ok=True)
conn = get_conn(); conn.autocommit = True

# ── 1. 인증마크 ────────────────────────────────────────────
crows = cert_load(conn)
cprods = {r['goods_no'] for r in crows}
n = len(cprods) or 1
op = {r['goods_no'] for r in crows if not r['is_competitor']}
cp = {r['goods_no'] for r in crows if r['is_competitor']}

by_group, by_name, forms = defaultdict(set), defaultdict(set), defaultdict(Counter)
types, tg = defaultdict(set), defaultdict(lambda: defaultdict(set))
for r in crows:
    types[r['ptype']].add(r['goods_no'])
    for c in r['certs']:
        g = group_of(c)
        forms[norm(c)][c] += 1
        by_name[norm(c)].add(r['goods_no'])
        if g:
            by_group[g].add(r['goods_no'])
            tg[r['ptype']][g].add(r['goods_no'])

with_any = len({r['goods_no'] for r in crows if r['certs']})
cert_groups = []
for g, s in sorted(by_group.items(), key=lambda x: -len(x[1])):
    cert_groups.append({
        'k': g, 'pct': round(len(s)*100/n), 'n': len(s),
        'our': round(len(s & op)*100/max(len(op),1)),
        'comp': round(len(s & cp)*100/max(len(cp),1)),
        'kw': list(GROUPS.get(g, ()))[:6],
    })
cert_top = []
for k, s in sorted(by_name.items(), key=lambda x: -len(x[1]))[:14]:
    disp = forms[k].most_common(1)[0][0]
    cert_top.append({'t': disp[:40], 'n': len(s), 'g': group_of(disp) or '미분류'})
cert_types = []
for t, ps in sorted(types.items(), key=lambda x: -len(x[1])):
    if len(ps) < 4 or t == '기타':
        continue
    hits = sorted(tg[t].items(), key=lambda x: -len(x[1]))[:5]
    cert_types.append({'k': t, 'n': len(ps),
                       'g': [[g, round(len(s)*100/len(ps))] for g, s in hits]})

certs = {'nProd': n, 'withAny': with_any, 'pctAny': round(with_any*100/n),
         'groups': cert_groups, 'top': cert_top, 'byType': cert_types}

# ── 2. 분류 기준 — 이 숫자가 어디서 나왔는지 보여준다 ────────
rows = _load(conn)
role_n = Counter(r['role'] for r in rows)
role_p = defaultdict(set)
for r in rows:
    role_p[r['role']].add(r['goods_no'])
nprod = len({r['goods_no'] for r in rows})

def axis(d, counts=None, prods=None):
    out = []
    for k, v in d.items():
        e = {'k': k, 'd': v}
        if counts is not None:
            e['n'] = counts.get(k, 0)
            e['pct'] = round(len(prods.get(k, ()))*100/nprod) if prods else None
        out.append(e)
    return out

taxonomy = {
    'nProd': nprod, 'nSec': len(rows),
    'role': sorted(axis(ROLES, role_n, role_p), key=lambda x: -(x.get('n') or 0)),
    'copy': axis(COPY_TYPES), 'visual': axis(VISUAL_TYPES), 'evidence': axis(EVIDENCE_TYPES),
}

# ── 3. 소구어 후보 — 하드코딩 대신 데이터에서 ───────────────
terms_all = _appeal_terms(rows)
appeal_opts = [t for t, c in terms_all.most_common(60)
               if len(t) >= 2 and c >= 3][:36]
by_type_terms = {}
for t in {r['ptype'] for r in rows}:
    rs = [r for r in rows if r['ptype'] == t]
    if len({r['goods_no'] for r in rs}) < 5 or t == '기타':
        continue
    by_type_terms[t] = [a for a, _ in _appeal_terms(rs).most_common(20)]

extra = {'certs': certs, 'taxonomy': taxonomy,
         'appealOpts': appeal_opts, 'appealByType': by_type_terms}
p = os.path.join(D, 'extra.json')
io.open(p, 'w', encoding='utf-8').write(json.dumps(extra, ensure_ascii=False))
print(f'저장 {p}  {os.path.getsize(p)/1024:.0f}KB')
print(f"인증마크: 상품 {n}개 중 {with_any}개가 사용 ({round(with_any*100/n)}%) · 묶음 {len(cert_groups)}종")
print(f"분류 기준: 역할 {len(ROLES)} · 카피 {len(COPY_TYPES)} · 비주얼 {len(VISUAL_TYPES)} · 근거 {len(EVIDENCE_TYPES)}")
print(f"소구어 후보 {len(appeal_opts)}개: {', '.join(appeal_opts[:12])}...")
conn.close()

"""생성기 데이터 산출 — 스크래치패드에서 레포로 옮긴 것.

2주 주기 작업이 이 코드를 돌려야 하는데 임시 폴더에 있으면 세션이 끝날 때
사라진다. 출력 경로만 바꾸고 나머지는 그대로 옮겼다.
"""
"""인증마크 상세 — extra.json 의 certs 블록만 다시 만든다.

BM 질문은 두 겹이다.
  1) 어떤 제품군이 어떤 묶음을 박는가
  2) 그 묶음 안에서 실제로 쓰는 이름은 뭐고 그중 몇 %인가
히트맵은 1)만 답한다. 그래서 '유형별 뷰' 를 통째로 미리 계산해 두고
화면에서는 유형만 갈아끼우며 막대로 본다.

마크 비율의 분모는 '그 묶음을 쓰는 상품 수'다. 한 상품이 같은 묶음의
이름을 여러 개 박을 수 있으므로 합계는 100%를 넘는다 — 누적 막대가 아니라
각각의 막대로 그려야 하는 이유다.
"""
import sys, os, io, json
from collections import Counter, defaultdict

sys.path.insert(0, r'C:\oliveyounginsight\Ollive0-CellFusionC-Review')
from dotenv import load_dotenv
load_dotenv(r'C:\oliveyounginsight\Ollive0-CellFusionC-Review\.env')
from db.schema import get_conn
from collector.detail_page_certs import _load as cert_load, group_of, norm, GROUPS

import os as _os
D = _os.environ.get('DETAIL_EXPORT_DIR') or _os.path.join(
    _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))),
    'exports', '_webdata')
_os.makedirs(D, exist_ok=True)
MIN_TYPE = 6      # 상품이 이보다 적은 유형은 비율이 요동쳐서 안 보여준다
MARKS_PER_GROUP = 8
ZONES = ("초반", "전반", "중반", "후반", "마무리")


def zone_of(pct):
    if pct is None:
        return None
    return ZONES[min(int(float(pct) // 20), 4)]


conn = get_conn()
conn.autocommit = True
rows = cert_load(conn)

prods = {r['goods_no'] for r in rows}
n_all = len(prods) or 1
ours = {r['goods_no'] for r in rows if not r['is_competitor']}
comps = {r['goods_no'] for r in rows if r['is_competitor']}

ptype = {}
forms = defaultdict(Counter)                       # 정규화 이름 -> 표기 빈도
by_group = defaultdict(set)                        # 그룹 -> 상품 (전체)
by_name = defaultdict(set)                         # 이름 -> 상품 (전체)
gzone = defaultdict(Counter)
grole = defaultdict(Counter)
unc = defaultdict(set)
# 유형별: 그룹 -> 상품,  (그룹,이름) -> 상품
tg = defaultdict(lambda: defaultdict(set))
tgn = defaultdict(lambda: defaultdict(set))

for r in rows:
    gno, t = r['goods_no'], r['ptype']
    ptype[gno] = t
    z, ro = zone_of(r['scroll_pct']), r['role']
    here = set()                                   # 이 섹션에 등장한 묶음
    for c in r['certs']:
        k = norm(c)
        forms[k][c] += 1
        by_name[k].add(gno)
        g = group_of(c)
        if not g:
            unc[k].add(gno)
            continue
        here.add(g)
        by_group[g].add(gno)
        tg[t][g].add(gno)
        tgn[t][(g, k)].add(gno)
    # 위치·역할은 '섹션이 몇 개인가'를 묻는 값이다. 마크마다 더하면 마크를
    # 많이 박은 섹션이 두 배로 세어진다 (피부 안전시험 710 vs 실제 475 섹션, +49%).
    for g in here:
        if z:
            gzone[g][z] += 1
        if ro:
            grole[g][ro] += 1

types = defaultdict(set)
for p, t in ptype.items():
    types[t].add(p)

with_any = len({r['goods_no'] for r in rows if r['certs']})
order = [g for g, _ in sorted(by_group.items(), key=lambda x: -len(x[1]))]


def disp(k):
    return forms[k].most_common(1)[0][0][:44]


def view(label, prod_set, per_type_names):
    """한 유형(또는 전체)의 묶음별 수치 + 묶음 안의 이름 구성."""
    base = len(prod_set) or 1
    out = []
    for g in order:
        gp = by_group[g] & prod_set
        if not gp:
            out.append({'k': g, 'pct': 0, 'n': 0, 'marks': []})
            continue
        names = [(k2, ps) for (g2, k2), ps in per_type_names.items() if g2 == g]
        names.sort(key=lambda x: -len(x[1]))
        marks = [{'t': disp(k2), 'n': len(ps),
                  'pct': round(len(ps) * 100 / len(gp))}
                 for k2, ps in names[:MARKS_PER_GROUP]]
        out.append({'k': g, 'pct': round(len(gp) * 100 / base),
                    'n': len(gp), 'marks': marks})
    return {'n': base, 'groups': out}


# 전체 뷰 — 유형 구분 없이 합친다
all_names = defaultdict(set)
for t in tgn:
    for key, ps in tgn[t].items():
        all_names[key] |= ps

views = {'전체': view('전체', prods, all_names)}
show_types = [(t, s) for t, s in sorted(types.items(), key=lambda x: -len(x[1]))
              if len(s) >= MIN_TYPE and t != '기타']
for t, ps in show_types:
    views[t] = view(t, ps, tgn[t])


def pctof(c, top=3):
    tot = sum(c.values()) or 1
    return [[k, round(v * 100 / tot)] for k, v in c.most_common(top)]


# 묶음 메타 — 유형을 바꿔도 변하지 않는 것 (자사격차·위치·기준어)
meta = []
for g in order:
    s = by_group[g]
    meta.append({
        'k': g, 'n': len(s), 'pct': round(len(s) * 100 / n_all),
        'our': round(len(s & ours) * 100 / max(len(ours), 1)),
        'comp': round(len(s & comps) * 100 / max(len(comps), 1)),
        'kw': list(GROUPS.get(g, ()))[:6],
        'zone': pctof(gzone[g], 3), 'roles': pctof(grole[g], 3),
    })

top = [{'t': disp(k), 'n': len(ps), 'g': group_of(disp(k)) or '미분류'}
       for k, ps in sorted(by_name.items(), key=lambda x: -len(x[1]))[:20]]
unclassified = [{'t': disp(k), 'n': len(ps)}
                for k, ps in sorted(unc.items(), key=lambda x: -len(x[1]))[:12]]

certs = {
    'nProd': n_all, 'withAny': with_any, 'pctAny': round(with_any * 100 / n_all),
    'nOur': len(ours), 'nComp': len(comps),
    'order': order, 'meta': meta, 'views': views,
    'typeList': ['전체'] + [t for t, _ in show_types],
    'top': top, 'unc': unclassified,
}

p = os.path.join(D, 'extra.json')
extra = json.load(io.open(p, encoding='utf-8'))
extra['certs'] = certs
io.open(p, 'w', encoding='utf-8', newline='\n').write(
    json.dumps(extra, ensure_ascii=False))

print('묶음', len(order), '· 뷰', len(views), '· 미분류', len(unclassified))
for g in views['전체']['groups'][:3]:
    inner = ' / '.join(f"{m['t'][:18]} {m['pct']}%" for m in g['marks'][:3])
    print(f"  {g['k']:<12} {g['pct']:>3}% ({g['n']}개)  →  {inner}")
probe = '선스틱' if '선스틱' in views else (certs['typeList'][1:2] or ['전체'])[0]
print(f'{probe} 상위:', ' · '.join(
    f"{g['k']} {g['pct']}%" for g in views[probe]['groups'][:4]))

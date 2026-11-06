"""네이버 쇼핑 가격 이력을 엑셀로 내보낸다 (2026-06-02 ~ 2026-07-30).

    python scripts/export_naver_prices.py                 # 주별 (기본)
    python scripts/export_naver_prices.py --period day    # 일별
    python scripts/export_naver_prices.py --period month  # 월별

왜 기간이 두 달뿐인가:
  네이버가 쇼핑 검색 API(search/shop.json)를 2026-07-31 에 완전히 종료했다.
  공식 대체 API 도 없다. 수집 시작(6/02)과 API 종료(7/30) 사이 두 달이 전부고,
  앞으로 늘어나지 않는다. 그래서 파일명과 시트에 기간을 박아 둔다.

올리브영과 섞지 않는다 — 채널이 다르고 기간도 다르다.

주의: 네이버 쇼핑은 같은 상품이 여러 판매처에 걸쳐 잡힌다. 여기서는 그날
      그 상품의 **최저가**를 쓴다(소비자가 실제로 보는 값에 가깝다).
      해외직구·묶음이 섞여 값이 튀는 행이 있으니 이상치는 걸러 보는 게 좋다.
"""
import argparse
import os
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from db.schema import get_conn

HEAD_FILL  = PatternFill('solid', fgColor='1F2937')
HEAD_FONT  = Font(color='FFFFFF', bold=True)
BRAND_FILL = PatternFill('solid', fgColor='E5E7EB')
OURS_FILL  = PatternFill('solid', fgColor='DBEAFE')
BRAND_FONT = Font(bold=True, size=11)
UP_FONT    = Font(color='B91C1C', bold=True)
DOWN_FONT  = Font(color='1D4ED8', bold=True)
THIN       = Side(style='thin', color='D1D5DB')


def _num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else f


def _pivot(wb, title, periods, groups, key, note):
    ws = wb.create_sheet(title)
    ws.append([note])
    ws['A1'].font = Font(size=9, color='6B7280')

    headers = ['브랜드', '상품명', '용량(ml)'] + periods + ['변동률', '판매처']
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        c = ws.cell(row=2, column=i)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(horizontal='center', vertical='center')
    for i, w in enumerate([14, 50, 10] + [10] * len(periods) + [10, 18], 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    n = len(periods)
    for brand, is_ours, items in groups:
        ws.append([f'{brand}  ({len(items)}개)'] + [''] * (len(headers) - 1))
        r = ws.max_row
        for i in range(1, len(headers) + 1):
            c = ws.cell(row=r, column=i)
            c.fill = OURS_FILL if is_ours else BRAND_FILL
            c.font = BRAND_FONT
            c.border = Border(top=THIN, bottom=THIN)

        for it in items:
            vals = [it[key].get(p) for p in periods]
            seen = [v for v in vals if v is not None]
            pct = round((seen[-1] - seen[0]) * 100.0 / seen[0], 1) \
                if len(seen) >= 2 and seen[0] else None
            ws.append(['', it['name'], it['volume']] + vals + [pct, it['mall']])
            r = ws.max_row
            for i in range(4, 4 + n):
                ws.cell(row=r, column=i).number_format = '#,##0'
            pc = ws.cell(row=r, column=4 + n)
            pc.number_format = '+0.0"%";-0.0"%"'
            if isinstance(pc.value, (int, float)) and pc.value:
                pc.font = UP_FONT if pc.value > 0 else DOWN_FONT

    ws.freeze_panes = 'D3'
    ws.auto_filter.ref = f'A2:{get_column_letter(len(headers))}2'


def run(period: str, out: str) -> None:
    conn = get_conn()
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout='60s'")

    bucket = {
        'month': "to_char(collected_date, 'YYYY-MM')",
        'week':  "to_char(date_trunc('week', collected_date), 'MM/DD')",
        'day':   "collected_date::text",
    }[period]

    # 같은 상품이 여러 판매처에 잡힌다. 그날의 최저가를 그 상품의 값으로 본다.
    cur.execute(f"""
        WITH daily AS (
            SELECT product_title, collected_date,
                   MIN(price) AS price,
                   MIN(volume_ml) AS volume_ml,
                   MIN(brand)     AS brand,
                   bool_or(is_ours) AS is_ours,
                   COUNT(DISTINCT mall_name) AS malls
            FROM naver.market_items
            WHERE price > 0
            GROUP BY product_title, collected_date
        )
        SELECT product_title, {bucket} AS bucket,
               (array_agg(price      ORDER BY collected_date DESC))[1] AS price,
               (array_agg(volume_ml  ORDER BY collected_date DESC))[1] AS volume_ml,
               (array_agg(brand      ORDER BY collected_date DESC))[1] AS brand,
               bool_or(is_ours) AS is_ours,
               MAX(malls) AS malls
        FROM daily
        GROUP BY product_title, {bucket}
    """)
    rows = cur.fetchall()

    cur.execute("""
        SELECT CASE WHEN is_ours THEN '자사' ELSE '경쟁사' END AS "구분",
               COALESCE(brand, '(미상)') AS "브랜드", product_title AS "상품명",
               collected_date::text AS "날짜", price AS "가격",
               mall_name AS "판매처", volume_ml AS "용량(ml)", category AS "카테고리"
        FROM naver.market_items
        WHERE price > 0
        ORDER BY is_ours DESC, brand, product_title, collected_date
    """)
    raw = cur.fetchall()
    conn.close()

    periods = sorted({r['bucket'] for r in rows})

    byprod: dict[str, dict] = {}
    for r in rows:
        d = byprod.setdefault(r['product_title'], {
            'name': r['product_title'], 'volume': _num(r['volume_ml']),
            'brand': r['brand'] or '(미상)', 'is_ours': bool(r['is_ours']),
            'mall': f"{r['malls']}곳" if r['malls'] else '', 'series': {}, 'unit': {},
        })
        p = _num(r['price'])
        d['series'][r['bucket']] = p
        v = _num(r['volume_ml'])
        d['unit'][r['bucket']] = round(p * 100.0 / v) if p and v else None
        if r['is_ours']:
            d['is_ours'] = True

    bybrand: dict[tuple, list] = defaultdict(list)
    for d in byprod.values():
        bybrand[(d['brand'], d['is_ours'])].append(d)

    groups = sorted(
        ((b, ours, sorted(items, key=lambda x: x['name']))
         for (b, ours), items in bybrand.items()),
        key=lambda g: (not g[1], -len(g[2]), g[0]))

    label = {'month': '월', 'week': '주', 'day': '일'}[period]
    note = (f'네이버 쇼핑 {label}별 가격 — 2026-06-02 ~ 2026-07-30 (API 종료로 수집 중단) · '
            f'그날 최저가 기준 · 빈 칸은 미수집 · 변동률은 처음 대비 마지막 · 파란 줄이 자사')

    wb = Workbook()
    wb.remove(wb.active)
    _pivot(wb, '추이', periods, groups, 'series', note)
    _pivot(wb, '단가추이', periods, groups, 'unit', note.replace('가격 —', '100ml당 —'))

    ws = wb.create_sheet('전체이력')
    headers = list(raw[0].keys()) if raw else []
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        c = ws.cell(row=1, column=i)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
    for i, w in enumerate([8, 14, 50, 12, 11, 18, 10, 14], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for r in raw:
        ws.append([_num(v) if k in ('가격', '용량(ml)') else v for k, v in r.items()])
    for row in range(2, ws.max_row + 1):
        ws.cell(row=row, column=5).number_format = '#,##0'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions

    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    wb.save(out)
    print(f"저장: {out}")
    print(f"  기간 {len(periods)}개: {', '.join(periods)}")
    print(f"  브랜드 {len(groups)}개 · 상품 {len(byprod):,}개 · 원본 {len(raw):,}행")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--period', default='week', choices=['month', 'week', 'day'])
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'exports', f"네이버_가격추이_2026-06~07_{datetime.now():%Y%m%d}.xlsx")
    run(a.period, out)

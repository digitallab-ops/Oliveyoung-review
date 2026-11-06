"""올리브영 가격 이력을 엑셀로 내보낸다.

    python scripts/export_price_history.py                    # 월별, 전체 기간
    python scripts/export_price_history.py --period week      # 주별
    python scripts/export_price_history.py --days 90          # 최근 90일만
    python scripts/export_price_history.py --out C:\\경로.xlsx

시트 구성
  추이        브랜드로 묶고 그 안에 제품을 줄세운다. 기간은 가로로 펼친다.
              한 줄만 따라가면 가격이 어떻게 움직였는지 보인다.
  단가추이    같은 모양으로 100단위당 가격.
  전체이력    날짜별 원본 기록. 피벗 돌릴 때 쓴다.

브랜드는 상품명 앞부분에서 뽑는다 — products 에 brand 컬럼이 없다.
용량 단위가 ml 과 g 이 섞여 있어 단가는 '100단위당' 으로 적었다.
가격 이력에는 판매가만 쌓인다 — 정가·할인율은 아직 수집하지 않는다.
"""
import argparse
import os
import re
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
UP_FONT    = Font(color='B91C1C', bold=True)   # 인상 — 빨강
DOWN_FONT  = Font(color='1D4ED8', bold=True)   # 인하 — 파랑
THIN       = Side(style='thin', color='D1D5DB')

_TAG = re.compile(r'\[[^\]]*\]')


def _num(v):
    """Decimal/None 을 엑셀이 받는 숫자로 편다."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else f


def brand_of(name: str | None) -> str:
    """상품명 앞에서 브랜드를 뽑는다.

    올리브영 상품명은 '[기획태그] 브랜드 제품명' 또는 '브랜드[태그] 제품명'
    꼴이다. 태그를 걷어낸 뒤 첫 토큰을 쓴다.
    """
    s = _TAG.sub(' ', name or '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s.split()[0] if s else '기타'


def short_name(name: str | None, brand: str) -> str:
    """브랜드 줄 아래에 놓이므로 앞의 태그와 브랜드는 뺀다."""
    s = _TAG.sub(' ', name or '')
    s = re.sub(r'\s+', ' ', s).strip()
    if s.startswith(brand):
        s = s[len(brand):].strip()
    return s or (name or '')


def _pivot_sheet(wb, title, periods, groups, key, note):
    ws = wb.create_sheet(title)
    ws.append([note])
    ws['A1'].font = Font(size=9, color='6B7280')

    headers = ['브랜드', '상품명', '용량'] + periods + ['변동률', '상품번호']
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        c = ws.cell(row=2, column=i)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(horizontal='center', vertical='center')
    for i, w in enumerate([14, 46, 13] + [11] * len(periods) + [10, 16], 1):
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
            ws.append(['', it['name'], it['volume'] or ''] + vals + [pct, it['goods_no']])
            r = ws.max_row
            for i in range(4, 4 + n):
                ws.cell(row=r, column=i).number_format = '#,##0'
            pc = ws.cell(row=r, column=4 + n)
            pc.number_format = '+0.0"%";-0.0"%"'
            if isinstance(pc.value, (int, float)) and pc.value:
                pc.font = UP_FONT if pc.value > 0 else DOWN_FONT

    ws.freeze_panes = 'D3'
    ws.auto_filter.ref = f'A2:{get_column_letter(len(headers))}2'
    return ws


def _raw_sheet(wb, rows):
    ws = wb.create_sheet('전체이력')
    headers = ['구분', '브랜드', '상품명', '날짜', '판매가', '정가', '할인율',
               '단가', '단가기준', '용량', '상품번호']
    ws.append(headers)
    for i, _ in enumerate(headers, 1):
        c = ws.cell(row=1, column=i)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(horizontal='center')
    for i, w in enumerate([8, 14, 46, 12, 11, 11, 8, 11, 10, 13, 16], 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for r in rows:
        ws.append([r['구분'], brand_of(r['상품명']), r['상품명'], r['날짜'],
                   _num(r['판매가']), _num(r['정가']), _num(r['할인율']),
                   _num(r['단가']), r['단가기준'], r['용량'], r['상품번호']])
    for col in (5, 6, 8):
        for row in range(2, ws.max_row + 1):
            ws.cell(row=row, column=col).number_format = '#,##0'
    for row in range(2, ws.max_row + 1):
        ws.cell(row=row, column=7).number_format = '0"%"'
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = ws.dimensions


def run(days: int | None, period: str, out: str) -> None:
    conn = get_conn()
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout='60s'")

    # 기간 버킷 — 경쟁사는 한 상품당 월 1회쯤 찍혀 월별이 기본이다.
    bucket = {
        'month': "to_char(ph.recorded_date, 'YYYY-MM')",
        'week':  "to_char(date_trunc('week', ph.recorded_date), 'MM/DD')",
        'day':   "ph.recorded_date::text",
    }[period]

    # 2026-11-05 이전 기록에는 sale_price/base_price/discount_rate 가 없다.
    # 그때는 정가만 받아왔기 때문이다(parse_price 가 price-before 를 먼저 집었다).
    # 그래서 '실판매가'는 sale_price 가 있으면 그걸, 없으면 price(정가)를 쓴다.
    sale_expr = "COALESCE(ph.sale_price, ph.price)"
    base_expr = "COALESCE(ph.base_price, ph.price)"
    # 단가는 올리브영이 계산해 준 값(unit_price)이 정확하다 — 묶음·증정까지 반영된다.
    # 없으면 용량 텍스트에서 추정한다.
    unit_expr = f"""COALESCE(ph.unit_price,
                   CASE WHEN substring(p.volume from '[0-9]+[.]?[0-9]*') IS NOT NULL
                         AND substring(p.volume from '[0-9]+[.]?[0-9]*')::numeric > 0
                        THEN ROUND({sale_expr} * 100.0
                             / substring(p.volume from '[0-9]+[.]?[0-9]*')::numeric)
                   END)"""
    where = "WHERE ph.recorded_date >= CURRENT_DATE - %s" if days else ""
    args = (days,) if days else ()

    cur.execute(f"""
        SELECT p.goods_no, p.goods_name, p.volume, p.is_competitor,
               {bucket} AS bucket,
               -- 한 기간에 여러 번 찍혔으면 그 기간의 마지막 값을 쓴다
               (array_agg({sale_expr}         ORDER BY ph.recorded_date DESC))[1] AS price,
               (array_agg({base_expr}         ORDER BY ph.recorded_date DESC))[1] AS base_price,
               (array_agg(ph.discount_rate    ORDER BY ph.recorded_date DESC))[1] AS discount_rate,
               (array_agg({unit_expr}         ORDER BY ph.recorded_date DESC))[1] AS unit_price
        FROM price_history ph
        JOIN products p USING (goods_no)
        {where}
        GROUP BY p.goods_no, p.goods_name, p.volume, p.is_competitor, {bucket}
    """, args)
    rows = cur.fetchall()

    cur.execute(f"""
        SELECT CASE WHEN p.is_competitor THEN '경쟁사' ELSE '자사' END AS "구분",
               p.goods_name AS "상품명", ph.recorded_date::text AS "날짜",
               {sale_expr} AS "판매가", {base_expr} AS "정가",
               ph.discount_rate AS "할인율", {unit_expr} AS "단가",
               ph.unit_basis AS "단가기준", p.volume AS "용량",
               p.goods_no AS "상품번호"
        FROM price_history ph JOIN products p USING (goods_no)
        {where}
        ORDER BY p.is_competitor, p.goods_name, ph.recorded_date
    """, args)
    raw = cur.fetchall()
    conn.close()

    periods = sorted({r['bucket'] for r in rows})

    byprod: dict[str, dict] = {}
    for r in rows:
        d = byprod.setdefault(r['goods_no'], {
            'goods_no': r['goods_no'], 'raw_name': r['goods_name'],
            'volume': r['volume'], 'is_ours': not r['is_competitor'],
            'series': {}, 'unit': {}, 'base': {}, 'disc': {},
        })
        # ROUND(numeric) 은 Decimal 로 온다. 엑셀에 넣고 계산도 해야 하니 숫자로 편다.
        d['series'][r['bucket']] = _num(r['price'])
        d['unit'][r['bucket']] = _num(r['unit_price'])
        d['base'][r['bucket']] = _num(r['base_price'])
        d['disc'][r['bucket']] = _num(r['discount_rate'])

    bybrand: dict[tuple, list] = defaultdict(list)
    for d in byprod.values():
        b = brand_of(d['raw_name'])
        d['name'] = short_name(d['raw_name'], b)
        bybrand[(b, d['is_ours'])].append(d)

    # 자사 먼저, 그다음 상품 수 많은 브랜드 순
    groups = sorted(
        ((b, ours, sorted(items, key=lambda x: x['name']))
         for (b, ours), items in bybrand.items()),
        key=lambda g: (not g[1], -len(g[2]), g[0]))

    label = {'month': '월', 'week': '주', 'day': '일'}[period]
    base = (f'{label}별 추이 · 한 기간에 여러 번 찍혔으면 마지막 값 · '
            f'빈 칸은 그 기간에 수집되지 않았다는 뜻 · 변동률은 처음 대비 마지막 · '
            f'파란 줄이 자사')

    note_old = ('2026-11-05 이전 기록은 정가만 받아 왔다 — 그 전 구간의 판매가·정가는 '
                '같은 값이고 할인율은 비어 있다. 세일은 그 이후부터 보인다.')

    wb = Workbook()
    wb.remove(wb.active)
    _pivot_sheet(wb, '판매가추이', periods, groups, 'series',
                 '실제 판매가(세일가) — ' + base + ' · ' + note_old)
    _pivot_sheet(wb, '정가추이', periods, groups, 'base', '정가(할인 전) — ' + base)
    _pivot_sheet(wb, '할인율추이', periods, groups, 'disc',
                 '할인율 % — ' + base + ' · ' + note_old)
    _pivot_sheet(wb, '단가추이', periods, groups, 'unit',
                 '단가(올리브영 표기 기준, 없으면 용량으로 추정) — ' + base)
    _raw_sheet(wb, raw)

    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    wb.save(out)
    print(f"저장: {out}")
    print(f"  기간 {len(periods)}개: {', '.join(periods)}")
    print(f"  브랜드 {len(groups)}개 · 상품 {len(byprod):,}개 · 원본 {len(raw):,}행")


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=None, help='최근 N일 (생략하면 전체)')
    ap.add_argument('--period', default='month', choices=['month', 'week', 'day'])
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'exports', f"올리브영_가격추이_{datetime.now():%Y%m%d}.xlsx")
    run(a.days, a.period, out)

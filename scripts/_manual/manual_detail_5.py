import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv; load_dotenv()
from collector.product_detail_collector import fetch_detail_page, parse_price, parse_volume, parse_bundle_info
from db.schema import get_conn, init_db

conn = get_conn(); conn.autocommit = True
init_db(conn=conn)
with conn.cursor() as cur:
    cur.execute('SELECT COUNT(*) as n FROM products WHERE is_competitor=true AND detail_fetched_at IS NULL')
    total = cur.fetchone()['n']
    cur.execute('SELECT goods_no, goods_name FROM products WHERE is_competitor=true AND detail_fetched_at IS NULL ORDER BY goods_name LIMIT 5')
    prods = list(cur.fetchall())

print(f'전체 수집 대상: {total}개')
for p in prods:
    gno = p['goods_no']
    gname = p['goods_name'] or ''
    volume = parse_volume(gname)
    bundle = parse_bundle_info(gname)
    soup = fetch_detail_page(gno)
    price = parse_price(soup) if soup else None
    info = []
    if price: info.append(f'{price:,}원')
    if volume: info.append(volume)
    if bundle: info.append(f'[{bundle[:30]}]')
    result = ' | '.join(info) if info else '가격 없음'
    print(f'  {gname[:45]}')
    print(f'    => {result}')
    time.sleep(2)

conn.close()

"""상세페이지 이미지 수집 — 구성 분석의 원재료.

올리브영 상세페이지는 내용이 전부 이미지다(실측: HTML 2.5만자에 텍스트 0자).
따라서 HTML 파싱으로는 아무것도 못 얻는다. 이미지 자체를 받아 비전 모델로 읽어야 한다.

구조적 특성:
  - 상세 내용은 '상품설명' 탭을 눌러야 로드된다 (메인 HTML은 껍데기)
  - 컨테이너는 #tempHtml2
  - img 태그의 src는 1x1 투명 GIF 플레이스홀더, 진짜 주소는 data-src에 있다

실행:
    python -m collector.detail_page_collector --category 선케어 --top 20
    python -m collector.detail_page_collector --goods A000000257097
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import random
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
IMG_ROOT = REPO / "exports" / "detail_pages"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")

# 대체 경로의 채택 기준. 장수로만 재면 틀린다 — 에스트라·라로슈포제는 상세페이지
# 전체가 이미지 '한 장'(720x30742px)이라 3장짜리가 되고, 장수 기준에 걸려 버려졌다.
# 그래서 장수 OR 총 높이 중 하나만 넘으면 받는다.
FALLBACK_MIN = 5          # 장수
FALLBACK_MIN_H = 3000     # 또는 합산 세로 픽셀

# 구분선·여백용 띠 이미지는 분석 가치가 없다. 세로가 이보다 작으면 버린다.
MIN_HEIGHT = 120


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS detail_pages (
                goods_no      VARCHAR(20) PRIMARY KEY,
                image_count   INT,
                kept_count    INT,
                total_height  INT,
                collected_at  TIMESTAMP DEFAULT NOW(),
                status        VARCHAR(20)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS detail_page_images (
                goods_no  VARCHAR(20) NOT NULL,
                seq       INT NOT NULL,
                url       TEXT NOT NULL,
                width     INT,
                height    INT,
                bytes     INT,
                local_path TEXT,
                PRIMARY KEY (goods_no, seq)
            )
        """)


def pick_by_type(conn, category: str, sun_type: str, limit: int) -> list[dict]:
    """특정 제품 유형만 골라온다. 이미 수집한 것은 건너뛴다.

    순위로는 구성 차이가 안 나왔고 제품 유형으로는 났다(12.7%p).
    그래서 표본을 '상위 N개'가 아니라 '유형별 N개'로 맞춘다.
    """
    from collector.detail_page_bytype import classify

    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (SELECT MAX(rank_date) d FROM market_rankings),
            snap AS (
                SELECT DISTINCT ON (mr.goods_no)
                       mr.goods_no, mr.rank_position, mr.goods_name
                FROM market_rankings mr
                JOIN latest ON mr.rank_date = latest.d
                WHERE mr.category_name = %s
                ORDER BY mr.goods_no, mr.rank_hour DESC, mr.rank_position
            )
            SELECT s.goods_no, s.rank_position, s.goods_name,
                   COALESCE(p.is_competitor, true) AS is_competitor
            FROM snap s
            LEFT JOIN products p ON p.goods_no = s.goods_no
            WHERE NOT EXISTS (SELECT 1 FROM detail_pages dp WHERE dp.goods_no = s.goods_no)
            ORDER BY s.rank_position
        """, (category,))
        rows = [dict(r) for r in cur.fetchall()]

    hit = [r for r in rows if classify(r["goods_name"]) == sun_type]
    return hit[:limit]


def pick_ours(conn, category: str, limit: int = 20) -> list[dict]:
    """자사 상품. 오늘 상위권에 없어도 최근 랭킹 이력이 있으면 대상으로 삼는다.

    자사가 Top 20에 없는 날이 많으므로 '오늘 상위 N개' 기준으로는 한 건도 못 잡는다.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (p.goods_no)
                   p.goods_no, mr.rank_position, p.goods_name, p.is_competitor
            FROM products p
            JOIN market_rankings mr ON mr.goods_no = p.goods_no
            WHERE p.is_competitor = false
              AND mr.category_name = %s
              AND mr.rank_date >= CURRENT_DATE - 30
            ORDER BY p.goods_no, mr.rank_date DESC, mr.rank_position
            LIMIT %s
        """, (category, limit))
        rows = [dict(r) for r in cur.fetchall()]
    return sorted(rows, key=lambda r: r["rank_position"])


def pick_targets(conn, category: str, top: int, skip_done: bool = True) -> list[dict]:
    """해당 카테고리 최신 스냅샷 상위 N개. 시간대 중복을 제거한다.

    이미 받아둔 상품은 건너뛴다. 수집은 Selenium이라 가장 비싼 단계고,
    확대할 때 같은 걸 다시 긁으면 그게 전부 낭비다.
    """
    with conn.cursor() as cur:
        cur.execute("""
            WITH latest AS (
                SELECT MAX(rank_date) AS d FROM market_rankings
            ), snap AS (
                SELECT DISTINCT ON (mr.goods_no)
                       mr.goods_no, mr.rank_position, mr.goods_name
                FROM market_rankings mr, latest
                WHERE mr.rank_date = latest.d
                  AND mr.category_name = %s
                ORDER BY mr.goods_no, mr.rank_hour DESC, mr.rank_position
            )
            SELECT t.goods_no, t.rank_position, t.goods_name, t.is_competitor
            FROM (
                SELECT s.goods_no, s.rank_position,
                       COALESCE(p.goods_name, s.goods_name) AS goods_name,
                       COALESCE(p.is_competitor, true) AS is_competitor
                FROM snap s
                LEFT JOIN products p ON p.goods_no = s.goods_no
                ORDER BY s.rank_position
                LIMIT %s
            ) t
            WHERE %s = false
               OR NOT EXISTS (SELECT 1 FROM detail_pages dp WHERE dp.goods_no = t.goods_no)
            ORDER BY t.rank_position
        """, (category, top, skip_done))
        return [dict(r) for r in cur.fetchall()]


def _driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    o = Options()
    o.add_argument("--headless=new")
    o.add_argument("--window-size=1280,1000")
    o.add_argument("--lang=ko-KR")
    o.add_argument("--disable-blink-features=AutomationControlled")
    o.add_argument(f"user-agent={UA}")
    o.add_experimental_option("excludeSwitches", ["enable-automation"])
    return webdriver.Chrome(options=o)


def fetch_image_urls(d, goods_no: str) -> list[str]:
    """상세 컨테이너에서 이미지 주소를 순서대로 뽑는다.

    2026-10 올리브영이 상품 페이지를 React 로 바꿨다. 대부분은 새 페이지 안에
    예전 #tempHtml2 가 그대로 남아 있어 계속 동작했지만, 두 가지가 깨졌다.
      1) 상품설명 탭이 <a> 가 아니라 button/li 가 되어 클릭이 100% 실패하고 있었다
         (#tempHtml2 가 DOM 에 이미 있어서 티가 안 났다)
      2) #tempHtml2 가 아예 없는 상품이 12.7% 생겼다 — 그쪽은 0장으로 끝났다
    그래서 탭 셀렉터를 넓히고, 없을 때 React 본문에서 긴 이미지를 줍는 길을 둔다.
    """
    d.get(f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}")
    time.sleep(3.5)

    # 탭은 a / button / li 어느 것이든 될 수 있다
    for xp in ('//*[self::a or self::button or self::li][contains(.,"상품설명")]',
               '//*[self::a or self::button or self::li][contains(.,"상세정보")]',
               '//a[contains(@href,"goods_detail")]'):
        els = d.find_elements("xpath", xp)
        if els:
            try:
                d.execute_script(
                    "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();", els[0])
                time.sleep(2.5)
            except Exception:
                pass
            break

    # 신형 페이지는 상세 내용을 '상품설명 더보기' 뒤에 접어 둔다.
    # 누르면 문서가 3천px → 2만5천px 로 늘어난다. 안 누르면 그냥 0장이다.
    for xp in ('//button[contains(normalize-space(.),"상품설명 더보기")]',
               '//a[contains(normalize-space(.),"상품설명 더보기")]'):
        els = d.find_elements("xpath", xp)
        if els:
            try:
                d.execute_script(
                    "arguments[0].scrollIntoView({block:'center'});", els[-1])
                time.sleep(0.4)
                d.execute_script("arguments[0].click();", els[-1])
                time.sleep(2.5)
            except Exception:
                pass
            break

    # 바닥까지 내려간다. 고정 횟수로는 펼쳐진 2만px 를 못 덮는다.
    last_h, stable = 0, 0
    for _ in range(40):
        d.execute_script("window.scrollBy(0, 2400);")
        time.sleep(0.45)
        h = d.execute_script(
            "return window.scrollY + window.innerHeight >= document.body.scrollHeight - 50"
            " ? -1 : document.body.scrollHeight;")
        if h == -1:
            stable += 1
            if stable >= 2:
                break
        elif h == last_h:
            stable += 1
            if stable >= 3:
                break
        else:
            stable = 0
        last_h = h
    time.sleep(1.0)   # 마지막 lazy 이미지가 뜰 틈

    urls = d.execute_script("""
        const r = document.querySelector('#tempHtml2');
        if (!r) return [];
        return Array.from(r.querySelectorAll('img'))
          .map(e => e.getAttribute('data-src') || e.currentSrc || e.src || '')
          .filter(s => s.startsWith('http'));
    """) or []
    if urls:
        return urls

    # 대체 경로 — 신형 본문에서 '세로로 긴 띠'만 줍는다.
    # 몇 장만 걸리면 상세 내용이 아니라 배너·갤러리를 주운 것이다.
    # 실측: 정상 상세페이지의 최소 장수는 6장, 5장 미만은 하나도 없었다.
    # 추천 캐러셀(curation/swiper)과 정사각 갤러리는 상세 내용이 아니다.
    alt = d.execute_script("""
        const root = document.querySelector('[class*=product-info-panel]')
                  || document.querySelector('#tab-panels')
                  || document.querySelector('[class*=product-details-container]');
        if (!root) return [];
        const bad = /curation|swiper|carousel|thumb|recommend|review/i;
        const out = [];
        root.querySelectorAll('img').forEach(e => {
          if (e.closest('[class*=curation],[class*=swiper],[class*=carousel]')) return;
          if (bad.test(String(e.className || ''))) return;
          const u = e.getAttribute('data-src') || e.currentSrc || e.src || '';
          if (!u.startsWith('http')) return;
          // 올리브영이 호스팅하는 작은 썸네일은 추천 영역이다
          if (/thumbnail/i.test(u)) return;
          const w = e.naturalWidth || e.width || 0;
          const h = e.naturalHeight || e.height || 0;
          // 상세 띠는 가로가 넓고 세로가 그보다 길거나 비슷하게 길다.
          // 아직 로드되지 않아 크기가 0인 것은 data-src 가 있으면 살린다.
          const unloaded = (w === 0 && h === 0 && e.hasAttribute('data-src'));
          if (!unloaded && !(w >= 500 && h >= 200 && h >= w * 0.4)) return;
          out.push({u: u, h: h});
        });
        return out;
    """) or []
    total_h = sum(int(x.get("h") or 0) for x in alt)
    if len(alt) >= FALLBACK_MIN or total_h >= FALLBACK_MIN_H:
        return [x["u"] for x in alt]
    return []


def download(goods_no: str, urls: list[str]) -> list[dict]:
    """이미지를 내려받고 너무 작은 것(구분선·여백)은 버린다."""
    from curl_cffi import requests as cf
    from PIL import Image
    import io

    sess = cf.Session(impersonate="chrome124")
    headers = {"Referer": "https://www.oliveyoung.co.kr/", "User-Agent": UA}
    out_dir = IMG_ROOT / goods_no
    out_dir.mkdir(parents=True, exist_ok=True)

    kept = []
    for i, u in enumerate(urls, 1):
        try:
            r = sess.get(u, headers=headers, timeout=30)
            if r.status_code != 200 or not r.content:
                continue
            try:
                im = Image.open(io.BytesIO(r.content))
                w, h = im.size
            except Exception:
                continue
            if h < MIN_HEIGHT:
                continue
            path = out_dir / f"{len(kept)+1:03d}.jpg"
            if im.mode in ("RGBA", "P", "LA"):
                im = im.convert("RGB")
            im.save(path, "JPEG", quality=85)
            kept.append({"seq": len(kept) + 1, "url": u, "width": w, "height": h,
                         "bytes": len(r.content), "local_path": str(path)})
        except Exception:
            continue
        time.sleep(random.uniform(0.2, 0.5))
    return kept


def save(conn, goods_no: str, raw_count: int, kept: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM detail_page_images WHERE goods_no = %s", (goods_no,))
        for k in kept:
            cur.execute("""
                INSERT INTO detail_page_images
                    (goods_no, seq, url, width, height, bytes, local_path)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (goods_no, k["seq"], k["url"], k["width"], k["height"],
                  k["bytes"], k["local_path"]))
        cur.execute("""
            INSERT INTO detail_pages (goods_no, image_count, kept_count, total_height, status)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (goods_no) DO UPDATE SET
                image_count=EXCLUDED.image_count, kept_count=EXCLUDED.kept_count,
                total_height=EXCLUDED.total_height, status=EXCLUDED.status,
                collected_at=NOW()
        """, (goods_no, raw_count, len(kept),
              sum(k["height"] for k in kept), "ok" if kept else "empty"))


def run(category: str = "선케어", top: int = 20, only: str | None = None,
        ours: bool = False, sun_type: str | None = None) -> None:
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)

    if only:
        targets = [{"goods_no": g.strip(), "rank_position": 0,
                    "goods_name": g.strip(), "is_competitor": True}
                   for g in only.split(",") if g.strip()]
    elif sun_type:
        targets = pick_by_type(conn, category, sun_type, top)
    elif ours:
        targets = pick_ours(conn, category, top)
    else:
        targets = pick_targets(conn, category, top)

    print(f"=== 상세페이지 수집 — {category} 상위 {len(targets)}개 ===\n")
    d = _driver()
    try:
        for i, t in enumerate(targets, 1):
            gno = t["goods_no"]
            nm = re.sub(r"\[[^\]]*\]", "", t["goods_name"]).strip()[:40]
            mark = "★" if not t["is_competitor"] else " "
            print(f"({i}/{len(targets)}) {mark}{t['rank_position']:>2}위 {nm}", flush=True)
            try:
                urls = fetch_image_urls(d, gno)
                kept = download(gno, urls)
                save(conn, gno, len(urls), kept)
                h = sum(k["height"] for k in kept)
                print(f"      원본 {len(urls)}장 → 유효 {len(kept)}장 · 세로 {h:,}px", flush=True)
            except Exception as e:
                print(f"      실패: {str(e).splitlines()[0][:70]}", flush=True)
            time.sleep(random.uniform(2.5, 4.5))
    finally:
        d.quit()
        conn.close()
    print("\n=== 완료 ===")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="선케어")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--goods", default=None, help="특정 상품만 (쉼표로 여러 개)")
    ap.add_argument("--ours", action="store_true", help="자사 상품 (최근 30일 랭킹 이력 기준)")
    ap.add_argument("--sun-type", dest="sun_type", default=None,
                    help="제품 유형만 (선크림/선세럼/선스틱/선쿠션/선패치/애프터선/기타)")
    a = ap.parse_args()
    run(a.category, a.top, a.goods, a.ours, a.sun_type)

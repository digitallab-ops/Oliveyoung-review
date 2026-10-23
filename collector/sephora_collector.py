"""세포라 상세페이지 수집 — 해외 비교용 파일럿.

왜 올리브영과 다르게 만드나:
  올리브영 상세페이지는 '글자가 박힌 이미지'다. 그래서 비전 모델로 읽어야 하고
  그게 이 프로젝트에서 가장 큰 지출이다(패널당 $0.0041).
  세포라는 같은 내용을 **라벨 붙은 평문**으로 준다.

    Highlights: Cruelty-Free / Non-Comedogenic / Water Resistant / Without Silicones
    What it is: ...
    Skin Type: ...
    Skincare Concerns: ...
    Formulation: Cream
    Highlighted Ingredients: ...
    Ingredient Callouts: Free of parabens, ... It is also vegan, gluten-free...
    Active Ingredients: Avobenzone 3.0%, Homosalate 7.0%, ...
    Suggested Usage: ...

  그래서 LLM 이 필요 없다. 파싱만 하면 되고 수집 비용은 0 이다.

접근 경로 (2026-10-23 실측):
  목록  api/v2/catalog/search  → 200 JSON. 브라우저 불필요.
  상세  api/*/catalog/products → 403. HTML 직접 요청도 403.
        셀레늄으로 열면 통과한다. 그래서 목록은 API, 상세는 브라우저다.
  주의  한국에서 접속하면 '다른 나라에서 접근 중' 안내가 함께 뜬다.
        내용은 정상적으로 나오지만 미국 기준 노출과 다를 수 있다.

실행:
    python -m collector.sephora_collector --keyword sunscreen --top 10
    python -m collector.sephora_collector --report
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from db.schema import get_conn  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
API = "https://www.sephora.com/api/v2/catalog/search/"
BASE = "https://www.sephora.com"

# 'About the Product' 아래에 라벨: 값 형태로 늘어서는 항목들.
# 올리브영 역할 분류에 대응시켜 두면 두 시장을 같은 축으로 볼 수 있다.
FIELDS = {
    "What it is": "핵심소구",
    "Skin Type": "타깃",
    "Skincare Concerns": "문제제기",
    "Formulation": "제형텍스처",
    "Highlighted Ingredients": "성분",
    "Ingredient Callouts": "인증클레임",
    "What Else You Need to Know": "핵심소구",
    "Active Ingredients": "성분",
    "Product Disclosures": "안내",
    "Suggested Usage": "사용법",
}
FIELD_RE = re.compile(r"^(" + "|".join(re.escape(k) for k in FIELDS) + r")\s*:\s*(.*)$")


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS sephora")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sephora.products (
                product_id   TEXT PRIMARY KEY,
                brand_name   TEXT,
                display_name TEXT,
                rating       REAL,
                review_count INT,
                url          TEXT,
                keyword      TEXT,
                rank_in_list INT,
                collected_at TIMESTAMP DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sephora.details (
                product_id   TEXT PRIMARY KEY,
                highlights   JSONB,     -- 클레임 배지 (= 올리브영 인증마크에 대응)
                fields       JSONB,     -- 라벨: 값
                body_len     INT,
                fetched_at   TIMESTAMP DEFAULT now()
            )
        """)


# ── 목록 (브라우저 불필요) ──────────────────────────────────
def search(keyword: str, top: int) -> list[dict]:
    from curl_cffi import requests as cf
    h = {"User-Agent": UA, "Accept": "application/json",
         "Accept-Language": "en-US,en;q=0.9"}
    r = cf.get(f"{API}?type=keyword&q={keyword}&pageSize={top}",
               headers=h, impersonate="chrome136", timeout=30)
    r.raise_for_status()
    out = []
    for i, p in enumerate(r.json().get("products") or [], 1):
        out.append({
            "product_id": p.get("productId"),
            "brand_name": p.get("brandName"),
            "display_name": p.get("displayName"),
            "rating": float(p["rating"]) if p.get("rating") else None,
            "review_count": int(p["reviews"]) if p.get("reviews") else None,
            "url": BASE + (p.get("targetUrl") or ""),
            "rank_in_list": i,
        })
    return out


# ── 상세 (브라우저 필요) ───────────────────────────────────
def _driver():
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    o = Options()
    for a in ("--headless=new", "--window-size=1280,2400", "--lang=en-US",
              "--disable-blink-features=AutomationControlled", f"user-agent={UA}"):
        o.add_argument(a)
    o.add_experimental_option("excludeSwitches", ["enable-automation"])
    return webdriver.Chrome(options=o)


def parse_body(text: str) -> tuple[list[str], dict]:
    """본문 평문에서 클레임 배지와 라벨 항목을 뽑는다."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    # Highlights ~ About the Product 사이가 배지다
    hi: list[str] = []
    try:
        a = lines.index("Highlights")
        for l in lines[a + 1:]:
            if l.startswith("About the Product") or l == "Ingredients":
                break
            # 'Best for Dry, Combo, Normal Skin' 처럼 피부타입 안내도 섞인다.
            # 배지로서 의미가 없으므로 뺀다.
            if l.startswith("Best for"):
                continue
            if 2 <= len(l) <= 40:
                hi.append(l)
    except ValueError:
        pass

    fields: dict[str, str] = {}
    cur_key = None
    for l in lines:
        m = FIELD_RE.match(l)
        if m:
            cur_key = m.group(1)
            fields[cur_key] = m.group(2).strip()
        elif cur_key and l.startswith("-") and len(fields.get(cur_key, "")) < 600:
            # 'Highlighted Ingredients:' 처럼 값이 다음 줄들로 이어지는 항목
            fields[cur_key] = (fields[cur_key] + " " + l.lstrip("- ")).strip()
        elif l in ("Show more", "Ingredients", "How to Use"):
            cur_key = None
    return hi, fields


def fetch_detail(d, url: str, waits: int = 6) -> tuple[list[str], dict, int]:
    d.get(url)
    text = ""
    for _ in range(waits):
        time.sleep(5)
        d.execute_script("window.scrollBy(0, 1800)")
        text = d.execute_script("return document.body.innerText") or ""
        if "About the Product" in text:
            break
    hi, fields = parse_body(text)
    return hi, fields, len(text)


def run(keyword: str, top: int) -> None:
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)

    prods = search(keyword, top)
    print(f"=== 세포라 '{keyword}' 상위 {len(prods)}개 ===\n")
    if not prods:
        print("목록이 비었다 — 검색 API 응답을 확인해라")
        return

    with conn.cursor() as cur:
        for p in prods:
            cur.execute("""
                INSERT INTO sephora.products
                    (product_id, brand_name, display_name, rating, review_count,
                     url, keyword, rank_in_list)
                VALUES (%(product_id)s,%(brand_name)s,%(display_name)s,%(rating)s,
                        %(review_count)s,%(url)s,%(kw)s,%(rank_in_list)s)
                ON CONFLICT (product_id) DO UPDATE SET
                    rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
                    rank_in_list = EXCLUDED.rank_in_list, collected_at = now()
            """, {**p, "kw": keyword})

    d = _driver()
    ok = 0
    try:
        for i, p in enumerate(prods, 1):
            short = f"{p['brand_name']} {p['display_name']}"[:46]
            print(f"({i}/{len(prods)}) {short}", flush=True)
            try:
                hi, fields, n = fetch_detail(d, p["url"])
            except Exception as e:
                print(f"      실패: {str(e).splitlines()[0][:70]}", flush=True)
                continue
            if not fields:
                print("      본문을 못 읽음 — 차단이거나 렌더가 느리다", flush=True)
                continue
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sephora.details
                        (product_id, highlights, fields, body_len)
                    VALUES (%s,%s,%s,%s)
                    ON CONFLICT (product_id) DO UPDATE SET
                        highlights = EXCLUDED.highlights, fields = EXCLUDED.fields,
                        body_len = EXCLUDED.body_len, fetched_at = now()
                """, (p["product_id"], json.dumps(hi, ensure_ascii=False),
                      json.dumps(fields, ensure_ascii=False), n))
            ok += 1
            print(f"      배지 {len(hi)}개 · 항목 {len(fields)}개", flush=True)
            time.sleep(2)
    finally:
        try:
            d.quit()
        except Exception:
            pass
    conn.close()
    print(f"\n=== 완료 — 상세 {ok}/{len(prods)}개 ===")


def report() -> None:
    conn = get_conn()
    conn.autocommit = True
    ensure_tables(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) n FROM sephora.products")
        np_ = cur.fetchone()["n"]
        cur.execute("SELECT count(*) n FROM sephora.details")
        nd = cur.fetchone()["n"]
        print(f"세포라 — 상품 {np_}개 · 상세 {nd}개\n")
        if not nd:
            conn.close()
            return
        cur.execute("""
            SELECT jsonb_array_elements_text(highlights) AS h, count(*) n
            FROM sephora.details GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 18
        """)
        print("클레임 배지 (= 올리브영 인증마크에 대응)")
        for r in cur.fetchall():
            print(f"  {r['n']:>3}개  {r['h']}")
        cur.execute("""
            SELECT k AS field, count(*) n
            FROM sephora.details, jsonb_object_keys(fields) AS k
            GROUP BY 1 ORDER BY 2 DESC
        """)
        print("\n라벨 항목 채움률")
        for r in cur.fetchall():
            print(f"  {r['n']:>3}/{nd}  {r['field']}  → {FIELDS.get(r['field'], '?')}")
    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keyword", default="sunscreen")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    if a.report:
        report()
    else:
        run(a.keyword, a.top)


if __name__ == "__main__":
    main()

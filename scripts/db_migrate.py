"""DB 이관 — 죽어가는 프로젝트에서 데이터를 빼내 새 프로젝트로 옮긴다.

이 스크립트가 이렇게 생긴 이유:

  pg_dump 가 이 머신에 없다. psql, Supabase CLI 도 없다. 그래서 psycopg2 의
  COPY 로 직접 뜬다.

  원본이 언제 다시 닫힐지 모른다(디스크가 차서 복구가 멈춘 상태였다).
  그래서 '한 번에 다 떠서 성공 아니면 실패'가 아니라, **표 하나 / 덩어리
  하나를 끝낼 때마다 기록**해서 끊기면 이어받는다. 같은 명령을 다시 쳐도
  이미 받은 건 건너뛴다.

  큰 표는 나눠 받는다. market_rankings 는 300만 행이라 한 번에 받다 끊기면
  처음부터다. 덩어리로 끊어 두면 잃는 건 마지막 덩어리뿐이다.

세 단계. 각각 따로 돌린다.

    python scripts/db_migrate.py dump      # 원본 -> 로컬 파일 (원본이 열려 있어야)
    python scripts/db_migrate.py restore   # 로컬 파일 -> 대상 (느긋하게 해도 됨)
    python scripts/db_migrate.py verify    # 양쪽 행 수 대조

환경변수:
    DATABASE_URL        원본 (현재 .env 의 값)
    TARGET_DATABASE_URL 대상 (새 프로젝트)
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import sys
import time

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
load_dotenv(os.path.join(ROOT, ".env"))

OUT = os.path.join(ROOT, "exports", "_migrate")
MANIFEST = os.path.join(OUT, "manifest.json")

# 우리가 만든 스키마만. extensions, auth 같은 Supabase 내부 스키마는 건드리지 않는다.
SCHEMAS = ["public", "oliveyoung", "coupang", "naver", "amazon", "sephora"]

# 한 덩어리 행 수. 끊겼을 때 잃는 양이자 메모리 사용량이다.
CHUNK = 200_000


def _conn(url_env: str):
    url = os.environ.get(url_env)
    if not url:
        raise SystemExit(f"{url_env} 가 비어 있다")
    return psycopg2.connect(url, cursor_factory=RealDictCursor,
                            connect_timeout=20,
                            options="-c statement_timeout=0")


def _load_manifest() -> dict:
    if os.path.exists(MANIFEST):
        with io.open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    return {"done": [], "ddl": False, "tables": {}}


def _save_manifest(m: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    tmp = MANIFEST + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)
    os.replace(tmp, MANIFEST)      # 쓰다 끊겨도 기존 기록이 남는다


# ── 구조 ────────────────────────────────────────────────
def dump_ddl(cur) -> str:
    """표·인덱스 정의를 SQL 로 뽑는다.

    pg_dump 가 없으니 카탈로그에서 직접 만든다. 제약 전부를 재현하지는
    않는다 — 목표는 '데이터를 담을 그릇'이고, 인덱스와 기본키까지면 충분하다.
    """
    sql: list[str] = []
    for s in SCHEMAS:
        sql.append(f'CREATE SCHEMA IF NOT EXISTS "{s}";')

    cur.execute("""
        SELECT table_schema s, table_name t
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE' AND table_schema = ANY(%s)
        ORDER BY 1, 2
    """, (SCHEMAS,))
    tables = [(r["s"], r["t"]) for r in cur.fetchall()]

    for s, t in tables:
        cur.execute("""
            SELECT a.attname AS col,
                   format_type(a.atttypid, a.atttypmod) AS typ,
                   a.attnotnull AS notnull,
                   pg_get_expr(d.adbin, d.adrelid) AS dflt
            FROM pg_attribute a
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum
        """, (f'"{s}"."{t}"',))
        cols = []
        for c in cur.fetchall():
            line = f'  "{c["col"]}" {c["typ"]}'
            if c["dflt"]:
                line += f' DEFAULT {c["dflt"]}'
            if c["notnull"]:
                line += " NOT NULL"
            cols.append(line)
        sql.append(f'CREATE TABLE IF NOT EXISTS "{s}"."{t}" (\n'
                   + ",\n".join(cols) + "\n);")

    # 인덱스·기본키는 정의문 그대로 가져온다 (IF NOT EXISTS 로 바꿔 둔다)
    cur.execute("""
        SELECT schemaname s, indexname n, indexdef d
        FROM pg_indexes WHERE schemaname = ANY(%s)
    """, (SCHEMAS,))
    for r in cur.fetchall():
        d = r["d"]
        if " INDEX " in d and "IF NOT EXISTS" not in d:
            d = d.replace(" INDEX ", " INDEX IF NOT EXISTS ", 1)
        sql.append(d + ";")

    cur.execute("""
        SELECT n.nspname s, c.relname t, con.conname cn,
               pg_get_constraintdef(con.oid) def
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY(%s) AND con.contype IN ('p', 'u')
    """, (SCHEMAS,))
    for r in cur.fetchall():
        # 이미 인덱스로 만들어졌을 수 있으니 실패해도 넘어가게 표시해 둔다
        sql.append(f'-- optional\nALTER TABLE "{r["s"]}"."{r["t"]}" '
                   f'ADD CONSTRAINT "{r["cn"]}" {r["def"]};')
    return "\n".join(sql) + "\n"


# ── 데이터 ──────────────────────────────────────────────
def _count(cur, s: str, t: str) -> int:
    cur.execute(f'SELECT count(*) AS n FROM "{s}"."{t}"')
    return cur.fetchone()["n"]


def dump() -> None:
    os.makedirs(OUT, exist_ok=True)
    m = _load_manifest()
    src = _conn("DATABASE_URL")
    src.autocommit = True
    cur = src.cursor()

    if not m.get("ddl"):
        print("구조 받는 중...", flush=True)
        ddl = dump_ddl(cur)
        with io.open(os.path.join(OUT, "schema.sql"), "w", encoding="utf-8") as f:
            f.write(ddl)
        m["ddl"] = True
        _save_manifest(m)
        print(f"  schema.sql ({len(ddl)/1024:.0f}KB)", flush=True)

    cur.execute("""
        SELECT table_schema s, table_name t
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE' AND table_schema = ANY(%s)
        ORDER BY 1, 2
    """, (SCHEMAS,))
    tables = [(r["s"], r["t"]) for r in cur.fetchall()]

    # 작은 표부터. 창이 짧을 때 빨리 확보되는 것부터 건진다.
    sized = []
    for s, t in tables:
        try:
            sized.append((_count(cur, s, t), s, t))
        except Exception as e:
            print(f"  {s}.{t} 행수 실패: {str(e).splitlines()[0][:50]}", flush=True)
    sized.sort()

    for n, s, t in sized:
        key = f"{s}.{t}"
        if key in m["done"]:
            print(f"  건너뜀 {key} (이미 받음)", flush=True)
            continue
        m["tables"][key] = n
        got = 0
        t0 = time.time()
        try:
            for off in range(0, max(n, 1), CHUNK):
                part = os.path.join(OUT, f"{key}.{off:09d}.csv.gz")
                if os.path.exists(part):
                    got += CHUNK
                    continue
                tmp = part + ".tmp"
                with gzip.open(tmp, "wb") as f:
                    cur.copy_expert(
                        f'COPY (SELECT * FROM "{s}"."{t}" '
                        f'ORDER BY 1 OFFSET {off} LIMIT {CHUNK}) '
                        f"TO STDOUT WITH (FORMAT csv)", f)
                os.replace(tmp, part)
                got = min(got + CHUNK, n)
                print(f"    {key} {got:,}/{n:,}", flush=True)
            m["done"].append(key)
            _save_manifest(m)
            print(f"  ✅ {key} {n:,}행 · {time.time()-t0:.0f}초", flush=True)
        except Exception as e:
            print(f"  ❌ {key} 중단: {str(e).splitlines()[0][:70]}", flush=True)
            print("     같은 명령을 다시 치면 여기서부터 이어받는다", flush=True)
            _save_manifest(m)
            src.close()
            raise SystemExit(1)

    src.close()
    print(f"\n=== 받기 완료 — 표 {len(m['done'])}개 ===")
    print(f"→ {OUT}")


def restore() -> None:
    m = _load_manifest()
    if not m.get("ddl"):
        raise SystemExit("schema.sql 이 없다 — dump 를 먼저 돌려라")
    tgt = _conn("TARGET_DATABASE_URL")
    tgt.autocommit = True
    cur = tgt.cursor()

    with io.open(os.path.join(OUT, "schema.sql"), encoding="utf-8") as f:
        ddl = f.read()
    print("구조 만드는 중...", flush=True)
    for stmt in [x.strip() for x in ddl.split(";\n") if x.strip()]:
        opt = stmt.startswith("-- optional")
        try:
            cur.execute(stmt)
        except Exception as e:
            if not opt:
                print(f"  DDL 경고: {str(e).splitlines()[0][:70]}", flush=True)

    for key in m["done"]:
        s, t = key.split(".", 1)
        parts = sorted(x for x in os.listdir(OUT)
                       if x.startswith(key + ".") and x.endswith(".csv.gz"))
        if not parts:
            continue
        try:
            cur.execute(f'SELECT count(*) AS n FROM "{s}"."{t}"')
            have = cur.fetchone()["n"]
        except Exception as e:
            # 표가 아예 안 만들어졌으면 여기서 멈추지 말고 알리고 넘어간다.
            # 한 표 때문에 나머지 35개를 못 넣는 일이 없게.
            print(f"  ❌ {key} 표 없음 — DDL 실패: "
                  f"{str(e).splitlines()[0][:60]}", flush=True)
            continue
        if have:
            print(f"  건너뜀 {key} (대상에 이미 있음)", flush=True)
            continue
        t0 = time.time()
        for p in parts:
            with gzip.open(os.path.join(OUT, p), "rb") as f:
                cur.copy_expert(f'COPY "{s}"."{t}" FROM STDIN WITH (FORMAT csv)', f)
        print(f"  ✅ {key} · 덩어리 {len(parts)}개 · {time.time()-t0:.0f}초", flush=True)

    # serial 로 되살린 컬럼은 시퀀스가 1에 머물러 있다. 그대로 두면 다음
    # INSERT 가 기존 id 와 부딪힌다. 적재가 끝난 뒤 최대값으로 올려 둔다.
    cur.execute("""
        SELECT n.nspname s, c.relname t, a.attname col
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
        WHERE c.relkind = 'r' AND n.nspname = ANY(%s)
          AND pg_get_serial_sequence(n.nspname || '.' || c.relname, a.attname) IS NOT NULL
    """, (SCHEMAS,))
    fixed = 0
    for r in cur.fetchall():
        try:
            cur.execute(
                'SELECT setval(pg_get_serial_sequence(%s, %s), '
                'COALESCE((SELECT MAX("' + r['col'] + '") FROM "' + r['s'] + '"."' + r['t'] + '"), 1))',
                (f"\"{r['s']}\".\"{r['t']}\"", r['col']))
            fixed += 1
        except Exception:
            pass
    print(f"시퀀스 {fixed}개 보정")

    tgt.close()
    print("\n=== 복원 완료 ===")


def verify() -> None:
    m = _load_manifest()
    tgt = _conn("TARGET_DATABASE_URL")
    tgt.autocommit = True
    cur = tgt.cursor()
    bad = 0
    print(f"{'표':<34}{'원본':>12}{'대상':>12}")
    for key, n in sorted(m.get("tables", {}).items()):
        s, t = key.split(".", 1)
        try:
            cur.execute(f'SELECT count(*) AS c FROM "{s}"."{t}"')
            c = cur.fetchone()["c"]
        except Exception:
            c = -1
        mark = "" if c == n else "  ← 불일치"
        if c != n:
            bad += 1
        print(f"{key:<34}{n:>12,}{c:>12,}{mark}")
    tgt.close()
    print(f"\n불일치 {bad}건")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=["dump", "restore", "verify"])
    a = ap.parse_args()
    {"dump": dump, "restore": restore, "verify": verify}[a.phase]()


if __name__ == "__main__":
    main()

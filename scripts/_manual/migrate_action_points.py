from db.schema import get_conn
conn = get_conn()
cur = conn.cursor()
cur.execute("ALTER TABLE promo_monthly_insights_history ADD COLUMN IF NOT EXISTS action_points TEXT[] NOT NULL DEFAULT '{}'")
conn.commit()
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='oliveyoung' AND table_name='promo_monthly_insights_history' ORDER BY ordinal_position")
print('컬럼:', [r['column_name'] for r in cur.fetchall()])
conn.close()
print('완료')

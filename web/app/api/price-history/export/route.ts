import { NextRequest, NextResponse } from 'next/server'
import { getPriceHistoryExport } from '@/lib/db'

export const maxDuration = 60

/**
 * 가격 이력 내려받기 (CSV).
 *
 * xlsx 로 주려면 라이브러리를 새로 넣어야 하는데, 배포 중인 앱에 의존성을
 * 더하는 쪽이 위험이 크다. CSV 는 앞에 BOM 만 붙이면 엑셀이 한글을 깨뜨리지
 * 않고 그대로 연다. 전체 기간 원본이 필요하면
 * `python scripts/export_price_history.py` 가 진짜 .xlsx 를 만든다.
 *
 * 로그인은 middleware 가 확인한다(/api/* 는 세션 없으면 401).
 */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    // 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 두 번 쓴다
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\r\n')
}

export async function GET(req: NextRequest) {
  const raw = parseInt(req.nextUrl.searchParams.get('days') ?? '180', 10)
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 730) : 180

  try {
    const rows = await getPriceHistoryExport(days)
    // BOM 이 없으면 엑셀이 UTF-8 을 못 알아보고 한글이 깨진다.
    const body = '﻿' + toCsv(rows as Record<string, unknown>[])
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const name = `oliveyoung_price_history_${today}.csv`

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // 파일명에 한글을 쓰면 브라우저마다 깨져서 ASCII 로 둔다
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[price-history/export]', e)
    return NextResponse.json({ error: '내보내기에 실패했습니다' }, { status: 500 })
  }
}

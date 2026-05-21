import { NextRequest, NextResponse } from 'next/server'
import { getOlivepickHistory, getTodayDealHistory } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')

  try {
    if (type === 'olivepick') {
      const data = await getOlivepickHistory()
      return NextResponse.json(data)
    }

    if (type === 'today_deal') {
      const from = searchParams.get('from')
      const to   = searchParams.get('to')
      if (!from || !to) {
        return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
      }
      const data = await getTodayDealHistory(from, to)
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: 'type must be olivepick or today_deal' }, { status: 400 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

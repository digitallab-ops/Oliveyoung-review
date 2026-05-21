import { NextRequest, NextResponse } from 'next/server'
import { savePromoMonthlyInsight, getPromoInsightHistory } from '@/lib/db'
import { generateOlivepickInsight } from '@/lib/ai'

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month')
  if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 })
  const history = await getPromoInsightHistory(month)
  return NextResponse.json(history)
}

export async function POST(req: NextRequest) {
  try {
    const { month, products } = await req.json() as {
      month: string
      products: { goods_name: string; category_name?: string | null }[]
    }

    if (!month || !products?.length) {
      return NextResponse.json({ error: 'month and products required' }, { status: 400 })
    }

    const result = await generateOlivepickInsight(
      month,
      products.map(p => ({ name: p.goods_name, category: p.category_name }))
    )
    if (!result) {
      return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
    }

    await savePromoMonthlyInsight(month, result.concept_tags, result.summary, result.action_points)
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { month, concept_tags, summary, action_points } = await req.json() as {
      month: string
      concept_tags: string[]
      summary: string
      action_points: string[]
    }

    if (!month) {
      return NextResponse.json({ error: 'month required' }, { status: 400 })
    }

    await savePromoMonthlyInsight(month, concept_tags ?? [], summary ?? '', action_points ?? [])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

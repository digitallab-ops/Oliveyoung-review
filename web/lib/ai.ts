import Anthropic from '@anthropic-ai/sdk'
import type { MarketCategoryData } from './types'
import { pool } from './db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildSlimPrompt(data: MarketCategoryData[]): string {
  const topRisers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta >= 3)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
    .slice(0, 10)
    .map(e => `${e.cat} ${e.rank_position}위 ${e.goods_name}(+${e.delta})`)

  const topFallers = data
    .flatMap(c => c.entries
      .filter(e => e.delta != null && e.delta <= -3)
      .map(e => ({ ...e, cat: c.category_name })))
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
    .slice(0, 3)
    .map(e => `${e.cat} ${e.rank_position}위 ${e.goods_name}(${e.delta})`)

  const leaders = data.map(c =>
    `${c.category_name}: ${c.entries[0]?.goods_name ?? '-'}`)

  const ours = data.flatMap(c =>
    c.entries.filter(e => e.is_ours)
      .map(e => `${c.category_name} ${e.rank_position}위${e.delta != null ? `(${e.delta > 0 ? '+' : ''}${e.delta})` : ''}`))

  return `오늘의 올리브영 스킨케어 베스트100 핵심 지표:
카테고리 1위: ${leaders.join(' / ')}
급상승: ${topRisers.join(', ') || '없음'}
급하락: ${topFallers.join(', ') || '없음'}
셀퓨전씨: ${ours.join(', ') || 'TOP100 없음'}

셀퓨전씨 마케터를 위한 시장 인사이트 3~4줄 (bullet point, 수치 포함, 한국어만)`
}

// 6시 수집 → 'am', 16시 수집 → 'pm'
function getSlot(): 'am' | 'pm' {
  const hour = new Date().getHours()
  return hour < 13 ? 'am' : 'pm'
}

export async function generateMarketInsight(data: MarketCategoryData[]): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY || data.length === 0) return ''

  const todayStr = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const slot = getSlot()

  // 1) 오늘 같은 슬롯 캐시 확인 → 있으면 재사용
  try {
    const cached = await pool.query(
      'SELECT insight_text FROM market_insights WHERE insight_date = $1 AND slot = $2',
      [todayStr, slot]
    )
    if (cached.rows[0]?.insight_text) return cached.rows[0].insight_text
  } catch { /* 테이블 없으면 skip */ }

  // 2) 슬림 프롬프트로 Claude 호출 (입력 ~200 토큰)
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: buildSlimPrompt(data) }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    if (!text) return ''

    // 3) DB 저장 (upsert, 슬롯 포함)
    await pool.query(`
      INSERT INTO market_insights (insight_date, slot, insight_text)
      VALUES ($1, $2, $3)
      ON CONFLICT (insight_date, slot) DO UPDATE
      SET insight_text = EXCLUDED.insight_text, generated_at = NOW()
    `, [todayStr, slot, text])

    return text
  } catch (e) {
    console.error('AI insight generation failed:', e)
    return ''
  }
}

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function scoreColor(score: number): string {
  if (score >= 5) return '#16A34A'
  if (score >= 4) return '#2D9C6E'
  if (score >= 3) return '#CA8A04'
  if (score >= 2) return '#EA580C'
  return '#DC2626'
}

export function scoreStars(score: number): string {
  return '★'.repeat(score) + '☆'.repeat(5 - score)
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  // "2024.05.07" or ISO string
  const d = dateStr.includes('T') ? new Date(dateStr) : null
  if (d) return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  return dateStr.slice(0, 10)
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '...'
}

export const SKIN_TYPE_MAP: Record<string, string> = {
  A01: '건성',
  A02: '지성',
  A03: '복합성',
  A04: '중성',
  A05: '민감성',
  A06: '아토피성',
  A07: '트러블성',
}

export function extractShortName(goods_name: string): string {
  return goods_name
    .replace(/\[.*?\]\s*/g, '')
    .replace(/^셀퓨전씨\s*/, '')
    .trim()
}

import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/db'

export const revalidate = 3600

export async function GET() {
  try {
    const products = await getProducts()
    return NextResponse.json(products)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }
}

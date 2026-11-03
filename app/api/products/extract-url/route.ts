// 상품 페이지 URL → 등록 화면 초안 (화면 내부용). { url } 하나를 받는다.
// 페이지 열기(SSRF 차단·robots.txt)와 읽기(Upstage)는 BE 가 한다 (POST /api/v1/products/extract-url) — 여기서는 BE 가 뽑은 평면 값을 등록 화면 모양으로 바꾼다.
import { NextResponse } from 'next/server'
import { forward } from '@/lib/api/backend'
import { toProductDraft, type ExtractedProduct } from '@/lib/products/extract-map'

// 페이지를 열어 인쇄하고 읽는 데 분 단위가 걸린다
export const maxDuration = 300

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url', code: 'VALIDATION_ERROR' }, { status: 400 })
  const res = await forward('/api/v1/products/extract-url', JSON.stringify({ url }))
  if (!res.ok) return res
  const { draft, sample } = (await res.json()) as { draft: ExtractedProduct; sample: boolean }
  return NextResponse.json({ draft: toProductDraft(draft), sample })
}

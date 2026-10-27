// 상품 소개서 업로드 → 등록 화면 초안 (화면 내부용). multipart로 file 하나를 받는다.
// 문서 읽기(Upstage)와 원본 보관은 BE 가 한다 (POST /api/v1/products/extract) — 여기서는 BE 가 뽑은 평면 값을 등록 화면 모양으로 바꾼다.
import { NextResponse } from 'next/server'
import { forward } from '@/lib/api/backend'
import { toProductDraft, type ExtractedProduct } from '@/lib/products/extract-map'

// 문서를 읽고 값을 뽑는 데 분 단위가 걸린다 (기본값으로는 끊긴다)
export const maxDuration = 300

export async function POST(request: Request) {
  const res = await forward('/api/v1/products/extract', await request.formData())
  if (!res.ok) return res
  const { draft, sample } = (await res.json()) as { draft: ExtractedProduct; sample: boolean }
  return NextResponse.json({ draft: toProductDraft(draft), sample })
}

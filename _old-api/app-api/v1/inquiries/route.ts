// TravelPass 고객 앱 전용 API. 로그인 세션이 아니라 x-api-key 헤더로 인증한다.
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/api/v1-auth.server'
import { parseCreateInquiryInput } from '@/lib/inquiries/validate'
import { createInquiryFromApp } from '@/lib/server/inquiries/service'
import type { ApiError } from '@/lib/api/contract'

export type CreateInquiryResponse = { id: string; createdAt: string }

export async function POST(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const parsed = parseCreateInquiryInput(await request.json().catch(() => null))
  if (!parsed.ok) {
    const message = parsed.error === 'invalidLanguage' ? '지원하지 않는 언어입니다.' : '필수 항목이 비어있습니다.'
    const err: ApiError = { error: message, code: 'VALIDATION_ERROR' }
    return NextResponse.json(err, { status: 400 })
  }

  const result = await createInquiryFromApp(parsed.value)
  if (!result.ok) {
    const err: ApiError = { error: '상품을 찾을 수 없습니다.', code: 'NOT_FOUND' }
    return NextResponse.json(err, { status: 404 })
  }

  const response: CreateInquiryResponse = { id: result.id, createdAt: result.createdAt }
  return NextResponse.json(response, { status: 201 })
}

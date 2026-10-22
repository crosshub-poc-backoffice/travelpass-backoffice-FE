// TravelPass 고객 앱 전용 API. 앱이 POST /api/v1/inquiries 응답으로 받은 id로 답변 상태를 조회한다.
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/api/v1-auth.server'
import { getInquiryForApp } from '@/lib/server/inquiries/service'
import type { ApiError } from '@/lib/api/contract'

export type GetInquiryResponse = NonNullable<Awaited<ReturnType<typeof getInquiryForApp>>>

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: RouteContext) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const { id } = await params
  const inquiry = await getInquiryForApp(id)
  if (!inquiry) {
    const err: ApiError = { error: '문의를 찾을 수 없습니다.', code: 'NOT_FOUND' }
    return NextResponse.json(err, { status: 404 })
  }

  return NextResponse.json(inquiry)
}

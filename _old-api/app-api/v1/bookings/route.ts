// TravelPass 고객 앱 전용 API. 로그인 세션이 아니라 x-api-key 헤더로 인증한다.
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/api/v1-auth.server'
import { parseCreateBookingInput } from '@/lib/bookings/validate'
import { createBookingFromApp } from '@/lib/server/bookings/service'
import type { BookingStatus as DbBookingStatus } from '@/lib/generated/prisma/client'
import type { ApiError } from '@/lib/api/contract'

export type CreateBookingResponse = { id: string; requestedAt: string; status: DbBookingStatus }

export async function POST(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const parsed = parseCreateBookingInput(await request.json().catch(() => null))
  if (!parsed.ok) {
    const err: ApiError = { error: '필수 항목이 비어있습니다.', code: 'VALIDATION_ERROR' }
    return NextResponse.json(err, { status: 400 })
  }

  const result = await createBookingFromApp(parsed.value)
  if (!result.ok) {
    // full: 즉시확정 상품인데 그 날짜 정원이 다 찼다 — 상품을 못 찾은 것과는 구분해서 409로 돌려준다.
    const err: ApiError =
      result.error === 'full'
        ? { error: '정원이 모두 찼습니다.', code: 'CONFLICT' }
        : { error: '상품을 찾을 수 없습니다.', code: 'NOT_FOUND' }
    return NextResponse.json(err, { status: result.error === 'full' ? 409 : 404 })
  }

  const response: CreateBookingResponse = { id: result.id, requestedAt: result.requestedAt, status: result.status }
  return NextResponse.json(response, { status: 201 })
}

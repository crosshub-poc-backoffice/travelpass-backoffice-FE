// TravelPass 고객 앱 전용 API. 고객이 앱에서 직접 예약을 취소할 때 호출한다.
import { NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/api/v1-auth.server'
import { cancelBookingFromApp } from '@/lib/server/bookings/service'
import type { ApiError } from '@/lib/api/contract'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: RouteContext) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const { id } = await params
  const result = await cancelBookingFromApp(id)
  if (!result.ok) {
    const err: ApiError = { error: '취소할 수 없는 예약입니다.', code: 'NOT_FOUND' }
    return NextResponse.json(err, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

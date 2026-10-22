'use server'

import { refresh } from 'next/cache'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { completeRefund, respondAsCustomer, sendQuote, setBookingStatus } from '@/lib/server/bookings/service'

export type ActionResult = { error?: 'notFound' | 'invalidAmount' }

export async function sendBookingQuote(id: string, input: { amount: number; message: string }): Promise<ActionResult> {
  const user = await requireMenu('bookings', 'edit')
  const result = await sendQuote(id, visiblePartnerIds(user), input)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export async function respondToBookingQuote(id: string, decision: 'accepted' | 'declined'): Promise<ActionResult> {
  const user = await requireMenu('bookings', 'edit')
  const result = await respondAsCustomer(id, visiblePartnerIds(user), decision)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export async function changeBookingStatus(id: string, status: 'rejected' | 'completed' | 'canceled', reason?: string): Promise<ActionResult> {
  const user = await requireMenu('bookings', 'edit')
  const result = await setBookingStatus(id, visiblePartnerIds(user), status, reason)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

// 환불 완료 처리. cancelFee = 업체가 확인한 최종 취소 수수료 (취소표 금액 이하로만)
export async function refundBooking(id: string, cancelFee: number): Promise<ActionResult> {
  const user = await requireMenu('bookings', 'edit')
  const result = await completeRefund(user, id, cancelFee)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

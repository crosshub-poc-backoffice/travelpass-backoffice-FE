'use server'

import { refresh } from 'next/cache'
import type { ErrorKey } from '@/lib/errors'
import { requireMenu } from '@/lib/server/auth/session'
import { saveAffiliateShare, savePgSetting } from '@/lib/server/payments/service'
import { markAffiliateSettlementPaid, markSettlementPaid, unmarkAffiliateSettlementPaid, unmarkSettlementPaid } from '@/lib/server/settlements/service'
import { PARTNER_TEXT_MAX } from '@/lib/partner-fields'
import { CURRENCY_PATTERN, isSupportedCurrency, MONTH_PATTERN, PAY_DAY_MAX, PG_NAME_MAX } from '@/lib/settlements'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type ActionResult = { error?: ErrorKey }

/** 지급완료 처리 (크로스허브). period는 YYYY-MM, payDate는 YYYY-MM-DD */
export async function markSettlementPaidAction(partnerId: string, period: string, payDate: string): Promise<ActionResult> {
  const user = await requireMenu('settlements', 'edit')
  if (typeof partnerId !== 'string' || !partnerId || !MONTH_PATTERN.test(String(period)) || !DAY_PATTERN.test(String(payDate))) return { error: 'notFound' }
  const result = await markSettlementPaid(user, partnerId, period, payDate)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export async function unmarkSettlementPaidAction(partnerId: string, period: string): Promise<ActionResult> {
  const user = await requireMenu('settlements', 'edit')
  if (typeof partnerId !== 'string' || !partnerId || !MONTH_PATTERN.test(String(period))) return { error: 'notFound' }
  const result = await unmarkSettlementPaid(user, partnerId, period)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

/** 연맹 지급완료 처리 (크로스허브). 통화별로 1행 */
export async function markAffiliateSettlementPaidAction(affiliateId: string, period: string, currency: string, payDate: string): Promise<ActionResult> {
  const user = await requireMenu('settlements', 'edit')
  if (typeof affiliateId !== 'string' || !affiliateId || !MONTH_PATTERN.test(String(period)) || !CURRENCY_PATTERN.test(String(currency)) || !DAY_PATTERN.test(String(payDate))) {
    return { error: 'notFound' }
  }
  const result = await markAffiliateSettlementPaid(user, affiliateId, period, currency, payDate)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export async function unmarkAffiliateSettlementPaidAction(affiliateId: string, period: string, currency: string): Promise<ActionResult> {
  const user = await requireMenu('settlements', 'edit')
  if (typeof affiliateId !== 'string' || !affiliateId || !MONTH_PATTERN.test(String(period)) || !CURRENCY_PATTERN.test(String(currency))) return { error: 'notFound' }
  const result = await unmarkAffiliateSettlementPaid(user, affiliateId, period, currency)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export type PgSettingFormState = { error?: ErrorKey; saved?: boolean }

/** 통화별 PG 설정 등록·수정 (크로스허브) */
export async function savePgSettingAction(_prev: PgSettingFormState, formData: FormData): Promise<PgSettingFormState> {
  const user = await requireMenu('settlements', 'edit')
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase()
  const pgName = String(formData.get('pgName') ?? '').trim()
  const feeRate = Number(String(formData.get('feeRate') ?? '').trim())
  const payDay = Number(String(formData.get('payDay') ?? '').trim())

  if (!isSupportedCurrency(currency)) return { error: 'currency' }
  if (!pgName) return { error: 'required' }
  if (pgName.length > PG_NAME_MAX) return { error: 'tooLong' }
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 100) return { error: 'feeRate' }
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > PAY_DAY_MAX) return { error: 'payDay' }

  // 수수료율은 소수 둘째 자리까지 (3.25%)
  const result = await savePgSetting(user, { currency, pgName, feeRate: Math.round(feeRate * 100) / 100, payDay })
  if (!result.ok) return { error: result.error }
  refresh()
  return { saved: true }
}

/** 연맹 몫(%p)·정산 계좌 저장 (크로스허브). 몫이 빈 값이면 미설정(0으로 계산), 계좌 칸은 빈 값이면 미등록 */
export async function saveAffiliateShareAction(
  id: string,
  input: { shareRate: string; bankName: string; bankAccountNumber: string; bankAccountHolder: string },
): Promise<ActionResult> {
  const user = await requireMenu('settlements', 'edit')
  if (typeof id !== 'string' || !id) return { error: 'notFound' }
  const bank = {
    bankName: String(input?.bankName ?? '').trim() || null,
    bankAccountNumber: String(input?.bankAccountNumber ?? '').trim() || null,
    bankAccountHolder: String(input?.bankAccountHolder ?? '').trim() || null,
  }
  if (Object.values(bank).some((v) => v && v.length > PARTNER_TEXT_MAX)) return { error: 'tooLong' }
  const trimmed = String(input?.shareRate ?? '').trim()
  let shareRate: number | null = null
  if (trimmed) {
    shareRate = Number(trimmed)
    if (!Number.isInteger(shareRate) || shareRate < 0 || shareRate > 100) return { error: 'shareRate' }
  }
  const result = await saveAffiliateShare(user, id, shareRate, bank)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

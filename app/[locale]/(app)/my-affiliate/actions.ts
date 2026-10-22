'use server'

import { refresh } from 'next/cache'
import type { ErrorKey } from '@/lib/errors'
import { PARTNER_TEXT_MAX } from '@/lib/partner-fields'
import { requireMenu } from '@/lib/server/auth/session'
import { saveMyAffiliateBank } from '@/lib/server/payments/service'

export type MyAffiliateFormState = { error?: ErrorKey; saved?: boolean }

/** 내 연맹 정산 계좌 저장. 빈 칸은 미등록(null) */
export async function saveMyAffiliateBankAction(_prev: MyAffiliateFormState, formData: FormData): Promise<MyAffiliateFormState> {
  const user = await requireMenu('myAffiliate', 'edit')
  const field = (key: string) => String(formData.get(key) ?? '').trim() || null
  const bank = { bankName: field('bankName'), bankAccountNumber: field('bankAccountNumber'), bankAccountHolder: field('bankAccountHolder') }
  if (Object.values(bank).some((v) => v && v.length > PARTNER_TEXT_MAX)) return { error: 'tooLong' }
  const result = await saveMyAffiliateBank(user, bank)
  if (!result.ok) return { error: result.error }
  refresh()
  return { saved: true }
}

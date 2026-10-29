'use server'

import { refresh } from 'next/cache'
import type { ErrorKey } from '@/lib/errors'
import { PARTNER_MEMO_MAX, PARTNER_NAME_MAX, PARTNER_TEXT_MAX, type PartnerInput } from '@/lib/partner-fields'
import { CURRENCY_PATTERN } from '@/lib/money'
import { requireMenu } from '@/lib/server/auth/session'
import { createPartner, togglePartnerActive, updatePartner } from '@/lib/server/partners/service'

const TEXT_FIELDS = [
  'name',
  'proxyAffiliateId',
  'currency',
  'managerName',
  'phone',
  'email',
  'memo',
  'businessRegistrationNumber',
  'representativeName',
  'corporateName',
  'address',
  'businessLicenseUrl',
  'subManager',
  'subManagerPhone',
] as const

export type PartnerFormValues = Record<(typeof TEXT_FIELDS)[number], string>

// values: 오류가 나도 React가 폼을 비우므로, 입력값을 돌려줘서 다시 채운다
export type PartnerFormState = { error?: ErrorKey; values?: PartnerFormValues; saved?: boolean }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readForm(formData: FormData): PartnerFormValues {
  const values = {} as PartnerFormValues
  for (const key of TEXT_FIELDS) values[key] = String(formData.get(key) ?? '').trim()
  return values
}

function parse(v: PartnerFormValues): { input: PartnerInput } | { error: ErrorKey } {
  if (!v.name) return { error: 'required' }
  if (v.name.length > PARTNER_NAME_MAX) return { error: 'nameLength' }

  const optional = [
    v.managerName,
    v.phone,
    v.email,
    v.businessRegistrationNumber,
    v.representativeName,
    v.corporateName,
    v.subManager,
    v.subManagerPhone,
  ]
  if (optional.some((s) => s.length > PARTNER_TEXT_MAX) || v.memo.length > PARTNER_MEMO_MAX || v.address.length > PARTNER_MEMO_MAX) return { error: 'tooLong' }
  if (v.email && !EMAIL_PATTERN.test(v.email)) return { error: 'emailFormat' }

  // 사업자등록증은 업로드 API가 돌려준 URL만 받는다 — 우리 저장소 것인지는 BE 가 본다 (아니면 licenseFile)

  // 통화는 크로스허브만 고른다 (다른 역할은 칸이 없어 비어 오고, 서비스가 저장하지 않는다)
  const currency = v.currency || 'JPY'
  if (!CURRENCY_PATTERN.test(currency)) return { error: 'currency' }

  return {
    input: {
      name: v.name,
      proxyAffiliateId: v.proxyAffiliateId || null,
      currency,
      managerName: v.managerName || null,
      phone: v.phone || null,
      email: v.email || null,
      memo: v.memo || null,
      businessRegistrationNumber: v.businessRegistrationNumber || null,
      representativeName: v.representativeName || null,
      corporateName: v.corporateName || null,
      address: v.address || null,
      businessLicenseUrl: v.businessLicenseUrl || null,
      subManager: v.subManager || null,
      subManagerPhone: v.subManagerPhone || null,
    },
  }
}

export async function createPartnerAction(_prev: PartnerFormState, formData: FormData): Promise<PartnerFormState> {
  const actor = await requireMenu('partners', 'edit', 'create')
  const values = readForm(formData)
  const parsed = parse(values)
  if ('error' in parsed) return { error: parsed.error, values }

  const result = await createPartner(actor, parsed.input)
  if (!result.ok) return { error: result.error, values }

  refresh()
  return { saved: true }
}

export async function updatePartnerAction(_prev: PartnerFormState, formData: FormData): Promise<PartnerFormState> {
  const actor = await requireMenu('partners', 'edit')
  const id = String(formData.get('id') ?? '')
  const values = readForm(formData)
  if (!id) return { error: 'notFound', values }
  const parsed = parse(values)
  if ('error' in parsed) return { error: parsed.error, values }

  const result = await updatePartner(actor, id, parsed.input)
  if (!result.ok) return { error: result.error, values }

  refresh()
  return { saved: true }
}

/** restoreProducts: 다시 활성화할 때 비활성화로 숨긴 상품을 노출중으로 되돌릴지 */
export async function togglePartnerActiveAction(id: string, restoreProducts = false): Promise<{ error?: ErrorKey }> {
  const actor = await requireMenu('partners', 'edit')
  if (typeof id !== 'string' || !id) return { error: 'notFound' }

  const result = await togglePartnerActive(actor, id, restoreProducts === true)
  if (!result.ok) return { error: result.error }

  refresh()
  return {}
}

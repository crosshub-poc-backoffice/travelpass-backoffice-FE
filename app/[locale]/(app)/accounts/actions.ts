'use server'

import { refresh } from 'next/cache'
import type { ErrorKey } from '@/lib/errors'
import { NEW_AFFILIATE } from '@/lib/accounts'
import { ROLES, type Role } from '@/lib/permissions'
import { createAccount, resetAccountPassword, toggleAccountActive } from '@/lib/server/accounts/service'
import { requireMenu } from '@/lib/server/auth/session'

type IssueValues = { role: string; name: string; loginId: string; affiliateId: string; partnerId: string; newAffiliateName: string }

// values: 오류가 나도 React가 폼을 비우므로, 입력값을 돌려줘서 다시 채운다
export type IssueState = {
  error?: ErrorKey
  values?: IssueValues
  issued?: { loginId: string; tempPassword: string }
}

const LOGIN_ID_PATTERN = /^[a-z0-9._-]{4,30}$/

export async function issueAccount(_prev: IssueState, formData: FormData): Promise<IssueState> {
  const actor = await requireMenu('accounts', 'edit', 'create')

  const role = String(formData.get('role') ?? '') as Role
  const name = String(formData.get('name') ?? '').trim()
  const loginId = String(formData.get('loginId') ?? '').trim().toLowerCase()
  const affiliateValue = String(formData.get('affiliateId') ?? '')
  const newAffiliateName = affiliateValue === NEW_AFFILIATE ? String(formData.get('newAffiliateName') ?? '').trim() : ''
  const affiliateId = affiliateValue === NEW_AFFILIATE ? null : affiliateValue || null
  const partnerId = String(formData.get('partnerId') ?? '') || null
  const values = { role, name, loginId, affiliateId: affiliateValue, partnerId: partnerId ?? '', newAffiliateName }

  // 이름은 크로스허브 계정만 받는다. 연맹·업체 계정은 소속명으로 채운다 (서비스)
  if (!ROLES.includes(role) || !loginId || (role === 'crosshub' && !name)) return { error: 'required', values }
  if (name.length > 50 || newAffiliateName.length > 50) return { error: 'nameLength', values }
  if (role === 'affiliate' && affiliateValue === NEW_AFFILIATE && !newAffiliateName) return { error: 'required', values }
  if (!LOGIN_ID_PATTERN.test(loginId)) return { error: 'loginIdFormat', values }
  // 역할과 소속이 어긋나면 거절 (예: 업체를 골랐는데 역할이 크로스허브)
  const orgMatches =
    (role === 'crosshub' && !affiliateId && !partnerId) ||
    (role === 'affiliate' && (!!affiliateId || !!newAffiliateName) && !partnerId) ||
    (role === 'partner' && !!partnerId && !affiliateId)
  if (!orgMatches) return { error: 'invalidOrg', values }

  const result = await createAccount({ role, name, loginId, affiliateId, partnerId, newAffiliateName: newAffiliateName || null })
  if (!result.ok) return { error: result.error, values }

  refresh()
  return { issued: { loginId: result.user.loginId, tempPassword: result.tempPassword } }
}

export type ResetResult = { error?: ErrorKey; loginId?: string; tempPassword?: string }

export async function resetPassword(userId: string): Promise<ResetResult> {
  const actor = await requireMenu('accounts', 'edit')
  if (typeof userId !== 'string' || !userId) return { error: 'notFound' }
  // 자기 계정을 초기화하면 지금 세션까지 끊겨 임시 비밀번호를 못 보고 잠긴다. 내 비밀번호는 비밀번호 변경에서
  if (userId === actor.id) return { error: 'resetSelf' }

  const result = await resetAccountPassword(userId)
  if (!result.ok) return { error: result.error }

  refresh()
  return { loginId: result.loginId, tempPassword: result.tempPassword }
}

export type ToggleActiveResult = { error?: ErrorKey; active?: boolean }

export async function toggleActive(userId: string): Promise<ToggleActiveResult> {
  const actor = await requireMenu('accounts', 'edit')
  if (typeof userId !== 'string' || !userId) return { error: 'notFound' }

  // 본인 계정 비활성화 금지는 FE에서도 막고, BE가 토큰 사용자 기준으로 한 번 더 막는다
  if (userId === actor.id) return { error: 'toggleSelf' }
  const result = await toggleAccountActive(userId)
  if (!result.ok) return { error: result.error }

  refresh()
  return { active: result.active }
}

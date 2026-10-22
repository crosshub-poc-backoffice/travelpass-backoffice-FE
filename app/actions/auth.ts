'use server'

import { refresh } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ErrorKey } from '@/lib/errors'
import { checkNewPassword, PASSWORD_MAX_LENGTH } from '@/lib/server/auth/password'
import { changeUserPassword, isLoginLocked, verifyCredentials } from '@/lib/server/auth/service'
import { createSession, deleteCurrentSession, getSessionUser, localePath, requireUser, setActivePartner } from '@/lib/server/auth/session'
import { recordLogin, requestInfo } from '@/lib/server/audit/access'

// loginId·remember: 로그인 실패 뒤 React가 폼을 비워도 입력값을 다시 채우려고 돌려준다
export type FormState = { error?: ErrorKey; loginId?: string; remember?: boolean }

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const loginId = String(formData.get('loginId') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const remember = formData.get('remember') === 'on'
  if (!loginId || !password) return { error: 'required', loginId, remember }
  if (password.length > PASSWORD_MAX_LENGTH) return { error: 'loginFailed', loginId, remember }

  // 비밀번호가 맞아도 막힌 동안은 확인하지 않는다
  if (await isLoginLocked(loginId, (await requestInfo()).ip)) {
    await recordLogin({ userId: null, loginId, event: 'failed', failReason: 'locked' })
    return { error: 'loginLocked', loginId, remember }
  }

  const result = await verifyCredentials(loginId, password)
  if (!result.ok) {
    await recordLogin({ userId: result.userId, loginId, event: 'failed', failReason: result.reason })
    return { error: 'loginFailed', loginId, remember }
  }
  const { user } = result
  await recordLogin({ userId: user.id, loginId, event: 'login' })

  await createSession(user.id, remember)
  redirect(await localePath(user.mustChangePassword ? '/change-password' : '/dashboard'))
}

export async function logout() {
  const user = await getSessionUser()
  if (user) await recordLogin({ userId: user.id, loginId: user.loginId, event: 'logout' })
  await deleteCurrentSession()
  redirect(await localePath('/'))
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ allowPasswordChange: true })
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!current || !next || !confirm) return { error: 'required' }
  const ruleError = checkNewPassword(next, user.loginId)
  if (ruleError) return { error: ruleError }
  if (next !== confirm) return { error: 'pwMismatch' }
  if (next === current) return { error: 'pwSame' }

  const ok = await changeUserPassword(user.id, user.sessionId, current, next)
  if (!ok) return { error: 'pwCurrentWrong' }

  redirect(await localePath('/dashboard'))
}

/** 업체 전환. partnerId가 null이면 관리 범위 전체 보기로 돌아간다. */
export async function switchPartner(partnerId: string | null) {
  const user = await requireUser()
  if (user.role === 'partner') return // 업체 계정은 자기 업체 고정
  if (partnerId !== null && !user.managedPartners.some((p) => p.id === partnerId)) return

  await setActivePartner(user, partnerId)
  refresh()
}

'use server'

import { refresh } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ErrorKey } from '@/lib/errors'
import { checkNewPassword } from '@/lib/server/auth/password'
import { changeUserPassword } from '@/lib/server/auth/service'
import { logoutUrl } from '@/lib/server/auth/keycloak'
import { deleteCurrentSession, getSessionUser, localePath, requireUser, setActivePartner } from '@/lib/server/auth/session'
import { recordLogin } from '@/lib/server/audit/access'

// 로그인은 Keycloak으로만 한다(app/api/auth/keycloak/*). 앱 DB 비밀번호 로그인(login 액션)은 제거했다.
export type FormState = { error?: ErrorKey }

export async function logout() {
  const user = await getSessionUser()
  if (user) await recordLogin({ userId: user.id, loginId: user.loginId, event: 'logout' })
  const { wasKeycloak, idToken } = await deleteCurrentSession()

  // Keycloak으로 로그인했으면 SSO 세션(KEYCLOAK_IDENTITY 쿠키)도 같이 끊어야 다음 "Keycloak로 로그인"이
  // 아이디/비번 없이 그냥 통과되지 않는다. id_token_hint를 보내면 Keycloak 확인 화면 없이 바로 돌아온다.
  // 비밀번호로 로그인한 세션은 Keycloak을 거치지 않는다.
  if (wasKeycloak) {
    const h = await headers()
    const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const origin = `${proto}://${h.get('host')}`
    redirect(logoutUrl(idToken, new URL(await localePath('/'), origin).toString()))
  }

  redirect(await localePath('/'))
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ allowPasswordChange: true })
  // Keycloak 로그인 사용자의 비밀번호는 Keycloak이 관리한다 (화면에서도 Keycloak 계정 콘솔로 보낸다)
  if (user.authMethod === 'keycloak') return { error: 'keycloakManagedPassword' }
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

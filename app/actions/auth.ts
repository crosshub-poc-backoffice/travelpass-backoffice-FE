'use server'

import { refresh } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { logoutUrl } from '@/lib/server/auth/keycloak'
import { deleteCurrentSession, getSessionUser, localePath, requireUser, setActivePartner } from '@/lib/server/auth/session'
import { recordLogin } from '@/lib/server/audit/access'

// 로그인은 Keycloak으로만 한다(app/api/auth/keycloak/*). 비밀번호 로그인·변경 액션은 제거했다 (비밀번호는 Keycloak이 관리).

export async function logout() {
  const user = await getSessionUser()
  if (user) await recordLogin({ userId: user.id, loginId: user.loginId, event: 'logout' })
  const { idToken } = await deleteCurrentSession()

  // Keycloak SSO 세션(KEYCLOAK_IDENTITY 쿠키)도 같이 끊어야 다음 로그인 때 아이디·비번을 다시 묻는다.
  // id_token_hint를 보내면 Keycloak 확인 화면 없이 바로 돌아온다.
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  const origin = `${proto}://${h.get('host')}`
  redirect(logoutUrl(idToken, new URL(await localePath('/'), origin).toString()))
}

/** 업체 전환. partnerId가 null이면 관리 범위 전체 보기로 돌아간다. */
export async function switchPartner(partnerId: string | null) {
  const user = await requireUser()
  if (user.role === 'partner') return // 업체 계정은 자기 업체 고정
  if (partnerId !== null && !user.managedPartners.some((p) => p.id === partnerId)) return

  await setActivePartner(user, partnerId)
  refresh()
}

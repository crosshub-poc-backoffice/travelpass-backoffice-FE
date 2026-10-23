import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { KEYCLOAK_LOGIN_COOKIE } from '@/lib/server/auth/cookie'
import { exchangeCode, verifyIdToken } from '@/lib/server/auth/keycloak'
import { createSession, localePath } from '@/lib/server/auth/session'
import { recordLogin } from '@/lib/server/audit/access'
import type { ErrorKey } from '@/lib/errors'

// Keycloak이 로그인 끝내고 돌아오는 주소.
// 1) state 대조(CSRF) → 2) code + client_secret + code_verifier로 토큰 교환(서버끼리, 브라우저 안 거침)
// 3) id_token 서명·iss·aud·exp·nonce 검증(JWKS) → 4) preferred_username으로 User 테이블(서비스 DB) 조회
// 5) 토큰을 서버 세션(DB)에 저장. 세션 수명은 Keycloak refresh 수명을 따른다.
// 비밀번호 변경은 Keycloak(Required action: Update Password)이 로그인 중에 처리하므로 여기서 /change-password로 보내지 않는다.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookieStore = await cookies()
  const saved = parseLoginCookie(cookieStore.get(KEYCLOAK_LOGIN_COOKIE)?.value)
  cookieStore.delete({ name: KEYCLOAK_LOGIN_COOKIE, path: '/api/auth/keycloak' })

  const fail = async (error: ErrorKey) => {
    const path = await localePath('/')
    return NextResponse.redirect(new URL(`${path}?error=${error}`, request.url))
  }

  // state 불일치·누락이면 CSRF 의심 — 바로 거절
  if (!code || !state || !saved || state !== saved.state) return fail('keycloakFailed')

  const redirectUri = new URL('/api/auth/keycloak/callback', request.url).toString()
  const tokens = await exchangeCode(code, redirectUri, saved.codeVerifier)
  if (!tokens?.id_token || !tokens.refresh_token) return fail('keycloakFailed')

  const claims = await verifyIdToken(tokens.id_token, saved.nonce)
  const username = claims?.preferred_username
  if (typeof username !== 'string' || !username) return fail('keycloakFailed')

  const user = await prisma.user.findUnique({
    where: { loginId: username },
    select: { id: true, active: true },
  })
  if (!user || !user.active) {
    await recordLogin({ userId: user?.id ?? null, loginId: username, event: 'failed', failReason: 'unknownId' })
    return fail('keycloakUnknownAccount')
  }

  await recordLogin({ userId: user.id, loginId: username, event: 'login' })
  await createSession(user.id, false, tokens)

  return NextResponse.redirect(new URL(await localePath('/dashboard'), request.url))
}

function parseLoginCookie(raw: string | undefined): { state: string; nonce: string; codeVerifier: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return typeof v?.state === 'string' && typeof v?.nonce === 'string' && typeof v?.codeVerifier === 'string' ? v : null
  } catch {
    return null
  }
}

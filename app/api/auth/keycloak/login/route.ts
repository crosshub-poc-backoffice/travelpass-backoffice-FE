import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { KEYCLOAK_LOGIN_COOKIE } from '@/lib/server/auth/cookie'
import { keycloakConfig, newLoginRequest } from '@/lib/server/auth/keycloak'

// Keycloak 로그인 시작점. "Keycloak로 로그인" 버튼이 이 주소로 이동한다.
// Confidential client + PKCE: 토큰 교환 때 client_secret(앱 증명)과 code_verifier(이번 로그인 증명)를 둘 다 낸다.
// state·nonce·code_verifier는 httpOnly 쿠키에 5분만 담아두고 콜백에서 대조 후 지운다.
export async function GET(request: Request) {
  const { issuer, clientId } = keycloakConfig()
  const redirectUri = new URL('/api/auth/keycloak/callback', request.url).toString()
  const { state, nonce, codeVerifier, codeChallenge } = newLoginRequest()

  const cookieStore = await cookies()
  cookieStore.set(KEYCLOAK_LOGIN_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/keycloak',
    maxAge: 300, // 5분 — 로그인 화면에서 오래 머물다 돌아오면 다시 시작하게
  })

  const authUrl = new URL(`${issuer}/protocol/openid-connect/auth`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'openid')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return NextResponse.redirect(authUrl)
}

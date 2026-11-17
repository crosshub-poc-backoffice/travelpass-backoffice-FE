import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hasLocale } from 'next-intl'
import { routing } from '@/i18n/routing'
import { KEYCLOAK_LOGIN_COOKIE } from '@/lib/server/auth/cookie'
import { exchangeCode, verifyIdToken } from '@/lib/server/auth/keycloak'
import { backendWithToken } from '@/lib/api/backend'
import { createSession, fetchMe } from '@/lib/server/auth/session'
import { recordLogin } from '@/lib/server/audit/access'
import type { ErrorKey } from '@/lib/errors'

// Keycloak이 로그인 끝내고 돌아오는 주소.
// 1) state 대조(CSRF) → 2) code + client_secret + code_verifier로 토큰 교환(서버끼리, 브라우저 안 거침)
// 3) id_token 서명·iss·aud·exp·nonce 검증(JWKS) → 4) access token 으로 BE GET /api/v1/me (등록·활성 여부는 BE 가 DB 로 판단)
// 5) 토큰을 FE 세션 저장소(Redis)에 저장. 세션 수명은 Keycloak refresh 수명을 따른다.
// 비밀번호 변경은 Keycloak(Required action: Update Password)이 로그인 중에 처리하므로 여기서 /change-password로 보내지 않는다.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookieStore = await cookies()
  const saved = parseLoginCookie(cookieStore.get(KEYCLOAK_LOGIN_COOKIE)?.value)
  cookieStore.delete({ name: KEYCLOAK_LOGIN_COOKIE, path: '/api/auth/keycloak' })

  // 돌아갈 언어: 로그인 시작 때 담아 둔 언어 → 없으면(쿠키 만료 등) 마지막으로 본 언어(NEXT_LOCALE) → 기본 언어.
  // /api 주소라 next-intl 의 getLocale() 은 항상 기본(ko)을 주므로 쓰지 않는다
  const loginLocale = saved?.locale
  const lastLocale = cookieStore.get('NEXT_LOCALE')?.value
  const locale = hasLocale(routing.locales, loginLocale)
    ? loginLocale
    : hasLocale(routing.locales, lastLocale)
      ? lastLocale
      : routing.defaultLocale

  const fail = (error: ErrorKey) => NextResponse.redirect(new URL(`/${locale}?error=${error}`, request.url))

  // state 불일치·누락이면 CSRF 의심 — 바로 거절
  if (!code || !state || !saved || state !== saved.state) return fail('keycloakFailed')

  const redirectUri = new URL('/api/auth/keycloak/callback', request.url).toString()
  const tokens = await exchangeCode(code, redirectUri, saved.codeVerifier)
  if (!tokens?.id_token || !tokens.refresh_token) return fail('keycloakFailed')

  const claims = await verifyIdToken(tokens.id_token, saved.nonce)
  const username = claims?.preferred_username
  if (typeof username !== 'string' || !username) return fail('keycloakFailed')

  const me = await fetchMe(tokens.access_token)
  if (me === 'roleMismatch') return fail('roleMismatch')
  if (!me) {
    await recordLogin(tokens.access_token, { event: 'failed', failReason: 'unknownId' })
    return fail('keycloakUnknownAccount')
  }

  // 로그인 기록과 "마지막 로그인" 시각 — 둘 다 BE
  await recordLogin(tokens.access_token, { event: 'login' })
  await backendWithToken('/api/v1/me/logged-in', tokens.access_token, 'POST')
  await createSession(me, tokens, {
    sid: typeof claims?.sid === 'string' ? claims.sid : null,
    sub: typeof claims?.sub === 'string' ? claims.sub : null,
  })

  return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
}

function parseLoginCookie(
  raw: string | undefined,
): { state: string; nonce: string; codeVerifier: string; locale?: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (typeof v?.state !== 'string' || typeof v?.nonce !== 'string' || typeof v?.codeVerifier !== 'string') return null
    return { state: v.state, nonce: v.nonce, codeVerifier: v.codeVerifier, locale: typeof v.locale === 'string' ? v.locale : undefined }
  } catch {
    return null
  }
}

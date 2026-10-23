import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { routing } from '@/i18n/routing'
import { logoutUrl } from '@/lib/server/auth/keycloak'
import { deleteCurrentSession } from '@/lib/server/auth/session'

// 토큰의 role과 DB의 role이 다를 때(BE 403 roleMismatch) lib/api/backend.ts가 이 주소로 보낸다.
// 그 상태로는 어떤 화면도 쓸 수 없으니 앱 세션과 Keycloak SSO 세션을 둘 다 끊고,
// 로그인 화면에서 "권한 정보가 맞지 않습니다" 안내를 보여준다 (관리자가 역할을 바로잡은 뒤 다시 로그인).
export async function GET(request: Request) {
  const { idToken } = await deleteCurrentSession()
  const saved = (await cookies()).get('NEXT_LOCALE')?.value
  const locale = (routing.locales as readonly string[]).includes(saved ?? '') ? saved! : routing.defaultLocale
  const back = new URL(`/${locale}?error=roleMismatch`, request.url).toString()
  return NextResponse.redirect(logoutUrl(idToken, back))
}

import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { SESSION_COOKIE } from './lib/server/auth/cookie'

const handleI18n = createMiddleware(routing)

// 파일명은 proxy.ts (Next.js 16에서 middleware.ts 컨벤션이 proxy로 이름 변경됨, 기능은 동일).
// 1) 세션 쿠키가 아예 없으면 로그인 화면(/{언어})으로 보낸다 — 1차 거름망일 뿐이고,
//    쿠키가 진짜인지·권한이 있는지는 각 layout·page·Server Action이 DB로 확인한다 (여기만 믿지 않는다).
// 2) 나머지는 next-intl이 언어 접두사를 붙이거나 맞춘다.
export function proxy(request: NextRequest) {
  const [first, ...rest] = request.nextUrl.pathname.split('/').filter(Boolean)
  const hasLocale = (routing.locales as readonly string[]).includes(first ?? '')
  const isLoginPage = !first || (hasLocale && rest.length === 0) // "/" 또는 "/ko"

  if (!isLoginPage && !request.cookies.has(SESSION_COOKIE)) {
    const savedLocale = request.cookies.get('NEXT_LOCALE')?.value
    const locale = hasLocale
      ? first
      : savedLocale && (routing.locales as readonly string[]).includes(savedLocale)
        ? savedLocale
        : routing.defaultLocale
    return NextResponse.redirect(new URL(`/${locale}`, request.url))
  }

  return handleI18n(request)
}

export const config = {
  // api, _next 정적 자산, 파일 확장자가 있는 경로(이미지 등)는 제외.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}

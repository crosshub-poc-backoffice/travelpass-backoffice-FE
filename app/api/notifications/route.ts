import { NextResponse } from 'next/server'
import { hasLocale } from 'next-intl'
import { routing } from '@/i18n/routing'
import { requireApiSession } from '@/lib/api/session.server'
import { listNotifications } from '@/lib/server/notifications/service'

// 알림 문구는 여기(서버)에서 만든다. /api 주소엔 언어가 없어 next-intl 이 기본(ko)으로 잡으므로,
// 화면이 보낸 ?locale= 로 그 언어 문구를 만든다. 잘못된 값이면 기본 언어.
export async function GET(request: Request) {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const requested = new URL(request.url).searchParams.get('locale')
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  const items = await listNotifications(auth.session.user, locale)
  return NextResponse.json({ items })
}

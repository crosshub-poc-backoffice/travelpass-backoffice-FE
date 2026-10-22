import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { getUnreadNotificationCount } from '@/lib/server/notifications/service'

export async function GET() {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const count = await getUnreadNotificationCount(auth.session.user)
  return NextResponse.json({ count })
}

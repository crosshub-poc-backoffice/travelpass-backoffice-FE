import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { markAllNotificationsRead } from '@/lib/server/notifications/service'

export async function POST() {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  await markAllNotificationsRead(auth.session.user)
  return NextResponse.json({ ok: true })
}

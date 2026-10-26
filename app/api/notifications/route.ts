import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { listNotifications } from '@/lib/server/notifications/service'

export async function GET() {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const items = await listNotifications(auth.session.user)
  return NextResponse.json({ items })
}

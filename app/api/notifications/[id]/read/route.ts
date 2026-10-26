import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { markNotificationRead } from '@/lib/server/notifications/service'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: RouteContext) {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const { id } = await params
  const ok = await markNotificationRead(auth.session.user, id)
  return NextResponse.json({ ok })
}

import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { dismissLiveNotification } from '@/lib/server/notifications/service'

export async function POST(request: Request) {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const body = (await request.json().catch(() => null)) as { key?: string } | null
  if (!body?.key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  await dismissLiveNotification(auth.session.user, body.key)
  return NextResponse.json({ ok: true })
}

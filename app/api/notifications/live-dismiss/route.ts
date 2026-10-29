import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { dismissLiveNotification } from '@/lib/server/notifications/service'

export async function POST(request: Request) {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const body = (await request.json().catch(() => null)) as { key?: string } | null
  // 키는 live 알림 id 모양(inquiry-/product-review- + id)만 받는다 — 아무 문자열이나 쌓이지 않게
  if (!body?.key || typeof body.key !== 'string' || !/^(inquiry|product-review)-[A-Za-z0-9_-]{1,64}$/.test(body.key)) {
    return NextResponse.json({ error: 'key required' }, { status: 400 })
  }

  await dismissLiveNotification(auth.session.user, body.key)
  return NextResponse.json({ ok: true })
}

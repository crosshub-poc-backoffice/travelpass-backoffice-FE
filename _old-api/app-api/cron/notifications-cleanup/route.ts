import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { retentionCutoff } from '@/lib/server/notifications/service'
import { accessLogCutoff } from '@/lib/server/audit/access'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: retentionCutoff() } } })
  // 접근 기록도 같은 cron에서 보관 기간(30일)이 지난 것을 지운다
  const access = await prisma.accessLog.deleteMany({ where: { createdAt: { lt: accessLogCutoff() } } })
  return NextResponse.json({ deleted: result.count, accessLogsDeleted: access.count })
}

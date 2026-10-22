import 'server-only'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'

export async function crosshubUserIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: 'crosshub', active: true }, select: { id: true } })
  return rows.map((u) => u.id)
}

export async function affiliateUserIds(affiliateId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: 'affiliate', affiliateId, active: true }, select: { id: true } })
  return rows.map((u) => u.id)
}

export async function partnerUserIds(partnerId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: 'partner', partnerId, active: true }, select: { id: true } })
  return rows.map((u) => u.id)
}

export async function partnerStakeholders(
  partnerId: string,
  opts: { includeCrosshub: boolean; includeAffiliate: boolean; includePartner: boolean },
): Promise<string[]> {
  const affiliateId = opts.includeAffiliate
    ? (await prisma.partner.findUnique({ where: { id: partnerId }, select: { proxyAffiliateId: true } }))?.proxyAffiliateId
    : null

  const or: Prisma.UserWhereInput[] = []
  if (opts.includeCrosshub) or.push({ role: 'crosshub' })
  if (opts.includeAffiliate && affiliateId) or.push({ role: 'affiliate', affiliateId })
  if (opts.includePartner) or.push({ role: 'partner', partnerId })
  if (or.length === 0) return []

  const rows = await prisma.user.findMany({ where: { active: true, OR: or }, select: { id: true } })
  return rows.map((u) => u.id)
}

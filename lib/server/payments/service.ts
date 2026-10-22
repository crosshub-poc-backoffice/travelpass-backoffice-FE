import 'server-only'
import { prisma } from '@/lib/db'
import { backend } from '@/lib/api/backend'
import type { PaymentType, Prisma } from '@/lib/generated/prisma/client'
import type { ErrorKey } from '@/lib/errors'
import { maskAccount, type AuditDetail } from '@/lib/audit'
import { PAGE_SIZE } from '@/lib/pagination'
import type { SessionUser } from '@/lib/server/auth/session'
import { audit } from '@/lib/server/audit/service'

// 결제 설정(통화별 PG)·연맹 몫·결제내역. 숫자는 전부 DB 설정값이라 코드에 박힌 수수료율이 없다

export type PgSettingRow = { currency: string; pgName: string; feeRate: number; payDay: number }

const pgSettingSelect = { currency: true, pgName: true, feeRate: true, payDay: true } satisfies Prisma.PgSettingSelect

export async function listPgSettings(): Promise<PgSettingRow[]> {
  return backend.get<PgSettingRow[]>('/api/v1/pg-settings')
}

export async function pgSettingMap(): Promise<Map<string, PgSettingRow>> {
  return new Map((await listPgSettings()).map((s) => [s.currency, s]))
}

/** 결제 행에 복사해 둘 PG사명. 그 통화에 설정이 없으면 '-' */
export async function pgNameFor(currency: string): Promise<string> {
  const found = await prisma.pgSetting.findUnique({ where: { currency }, select: { pgName: true } })
  return found?.pgName ?? '-'
}

type Result = { ok: true } | { ok: false; error: ErrorKey }

/** PG 수수료율 + 연맹 몫이 업체 수수료율을 넘으면 크로스허브 몫이 마이너스가 된다 — 설정·업체 저장 때 막는다.
 *  수수료율이 비어 있는 업체(아직 계약 전)는 검사하지 않는다 */
export async function sharesExceedCommission(partners: { commissionRate: number | null; pgFeeRate: number; affiliateShareRate: number }[]): Promise<boolean> {
  return partners.some((p) => p.commissionRate != null && p.commissionRate < p.pgFeeRate + p.affiliateShareRate)
}

/** 통화별 PG 설정 등록·수정. 크로스허브만. 바뀐 값은 작업 이력에 남긴다 */
export async function savePgSetting(user: SessionUser, input: PgSettingRow): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  const partners = await prisma.partner.findMany({ where: { currency: input.currency }, select: { commissionRate: true, proxyAffiliate: { select: { shareRate: true } } } })
  if (await sharesExceedCommission(partners.map((p) => ({ commissionRate: p.commissionRate, pgFeeRate: input.feeRate, affiliateShareRate: p.proxyAffiliate?.shareRate ?? 0 })))) {
    return { ok: false, error: 'sharesExceedCommission' }
  }
  const before = await prisma.pgSetting.findUnique({ where: { currency: input.currency }, select: pgSettingSelect })
  const detail: AuditDetail = {}
  for (const key of ['pgName', 'feeRate', 'payDay'] as const) {
    if (!before || before[key] !== input[key]) detail[key] = [before?.[key] ?? null, input[key]]
  }
  const data = { pgName: input.pgName, feeRate: input.feeRate, payDay: input.payDay }
  await prisma.$transaction([
    prisma.pgSetting.upsert({ where: { currency: input.currency }, create: { currency: input.currency, ...data }, update: data }),
    audit({ userId: user.id, action: 'settlement_setting', partnerId: null, targetId: input.currency, targetName: input.currency, detail }),
  ])
  return { ok: true }
}

export type AffiliateBank = { bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null }
export type AffiliateShareRow = { id: string; name: string; shareRate: number | null } & AffiliateBank

const BANK_FIELDS = ['bankName', 'bankAccountNumber', 'bankAccountHolder'] as const

export async function listAffiliateShares(): Promise<AffiliateShareRow[]> {
  return backend.get<AffiliateShareRow[]>('/api/v1/affiliate-shares')
}

/** 바뀐 계좌 칸만 이력용으로. 계좌번호는 뒤 4자리만 */
function bankDiff(before: AffiliateBank, after: AffiliateBank): AuditDetail {
  const detail: AuditDetail = {}
  for (const key of BANK_FIELDS) {
    if (before[key] !== after[key]) detail[key] = key === 'bankAccountNumber' ? [maskAccount(before[key]), maskAccount(after[key])] : [before[key], after[key]]
  }
  return detail
}

export type MyAffiliate = { name: string; shareRate: number | null } & AffiliateBank

/** 연맹 계정의 "내 연맹 정보" */
export async function getMyAffiliate(user: SessionUser): Promise<MyAffiliate | null> {
  if (user.role !== 'affiliate' || !user.affiliateId) return null
  return prisma.affiliate.findUnique({
    where: { id: user.affiliateId },
    select: { name: true, shareRate: true, bankName: true, bankAccountNumber: true, bankAccountHolder: true },
  })
}

/** 연맹이 자기 정산 계좌를 고친다. 연맹 몫은 크로스허브만 (결제 설정) */
export async function saveMyAffiliateBank(user: SessionUser, bank: AffiliateBank): Promise<Result> {
  if (user.role !== 'affiliate' || !user.affiliateId) return { ok: false, error: 'forbidden' }
  const existing = await prisma.affiliate.findUnique({
    where: { id: user.affiliateId },
    select: { name: true, bankName: true, bankAccountNumber: true, bankAccountHolder: true },
  })
  if (!existing) return { ok: false, error: 'notFound' }
  const detail = bankDiff(existing, bank)
  if (Object.keys(detail).length === 0) return { ok: true }
  await prisma.$transaction([
    prisma.affiliate.update({ where: { id: user.affiliateId }, data: bank }),
    audit({ userId: user.id, action: 'settlement_affiliate_bank', partnerId: null, targetId: user.affiliateId, targetName: existing.name, detail }),
  ])
  return { ok: true }
}

/** 연맹 몫(%p)·정산 계좌 변경. 크로스허브만. 몫과 계좌는 이력을 따로 남긴다 (계좌번호는 뒤 4자리만) */
export async function saveAffiliateShare(user: SessionUser, id: string, shareRate: number | null, bank: AffiliateBank): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  const existing = await prisma.affiliate.findUnique({ where: { id }, select: { name: true, shareRate: true, bankName: true, bankAccountNumber: true, bankAccountHolder: true } })
  if (!existing) return { ok: false, error: 'notFound' }

  const bankDetail = bankDiff(existing, bank)
  const bankChanged = Object.keys(bankDetail).length > 0
  const shareChanged = existing.shareRate !== shareRate
  if (!shareChanged && !bankChanged) return { ok: true }

  const [partners, settings] = await Promise.all([
    prisma.partner.findMany({ where: { proxyAffiliateId: id }, select: { commissionRate: true, currency: true } }),
    pgSettingMap(),
  ])
  if (shareChanged && (await sharesExceedCommission(partners.map((p) => ({ commissionRate: p.commissionRate, pgFeeRate: settings.get(p.currency)?.feeRate ?? 0, affiliateShareRate: shareRate ?? 0 }))))) {
    return { ok: false, error: 'sharesExceedCommission' }
  }
  await prisma.$transaction([
    prisma.affiliate.update({ where: { id }, data: { shareRate, ...bank } }),
    ...(shareChanged
      ? [audit({ userId: user.id, action: 'settlement_share', partnerId: null, targetId: id, targetName: existing.name, detail: { shareRate: [existing.shareRate, shareRate] } })]
      : []),
    ...(bankChanged ? [audit({ userId: user.id, action: 'settlement_affiliate_bank', partnerId: null, targetId: id, targetName: existing.name, detail: bankDetail })] : []),
  ])
  return { ok: true }
}

export type PaymentRow = {
  id: string
  createdAt: string
  bookingId: string
  partner: string
  currency: string
  productId: string
  productName: string
  /** productName이 보는 사람 언어의 AI 번역이면 true (페이지에서 채운다) */
  productNameAi?: boolean
  type: PaymentType
  amount: number
  pg: string
  pgTransactionId: string | null
}

export type PaymentFilter = { from: string; to: string; type: PaymentType | null; page: number }

const jstStart = (day: string) => new Date(`${day}T00:00:00+09:00`)

/** 결제내역. 업체 범위(partnerIds)는 호출하는 쪽이 세션에서 구해 넘긴다 (visiblePartnerIds) */
export async function listPayments(partnerIds: string[], filter: PaymentFilter): Promise<{ rows: PaymentRow[]; total: number }> {
  const where: Prisma.PaymentWhereInput = {
    booking: { product: { partnerId: { in: partnerIds } } },
    createdAt: { gte: jstStart(filter.from), lt: new Date(jstStart(filter.to).getTime() + 24 * 60 * 60 * 1000) },
    ...(filter.type ? { type: filter.type } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { booking: { select: { productId: true, product: { select: { name: true, partner: { select: { name: true, currency: true } } } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.payment.count({ where }),
  ])
  return {
    rows: rows.map((p) => ({
      id: p.id,
      createdAt: p.createdAt.toISOString(),
      bookingId: p.bookingId,
      partner: p.booking.product.partner.name,
      currency: p.booking.product.partner.currency,
      productId: p.booking.productId,
      productName: p.booking.product.name,
      type: p.type,
      amount: p.amount,
      pg: p.pg,
      pgTransactionId: p.pgTransactionId,
    })),
    total,
  }
}

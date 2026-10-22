import 'server-only'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { ErrorKey } from '@/lib/errors'
import { rateLabel, splitAmount } from '@/lib/fees'
import { type SessionUser, visiblePartnerIds } from '@/lib/server/auth/session'
import { audit } from '@/lib/server/audit/service'
import { pgSettingMap } from '@/lib/server/payments/service'
import { isMonthEnded, jstToday, shiftMonth } from '@/lib/settlements'

// 월별 정산. 지급대기 동안은 예약에서 그때그때 계산하고, 크로스허브가 지급완료 처리하는 순간 금액을 Settlement 행에
// 굳힌다 (그 뒤 예약·수수료율이 바뀌어도 지급한 숫자는 안 바뀐다). 지급 취소하면 행을 지워 다시 계산 상태로 돌아간다.

export type SettlementLine = {
  bookingId: string
  productId: string
  productName: string
  /** productName이 보는 사람 언어의 AI 번역이면 true (페이지에서 채운다) */
  productNameAi?: boolean
  useDate: string
  status: string
  /** 정산 기준 금액: 이용완료는 판매가, 취소·환불은 취소 수수료 */
  base: number
  commissionRate: number
  commission: number
  net: number
  isCancel: boolean
  /** 수수료 안의 배분. 예약 시점에 박힌 요율로 계산 (크로스허브 화면용) */
  affiliateShareRate: number
  affiliate: number
  pgFeeRate: number
  pg: number
}

export type SettlementRow = {
  partnerId: string
  partnerName: string
  currency: string
  /** 그 달 예약들의 수수료율. 섞이면 "12~15". 건이 없으면 업체의 지금 요율 */
  commissionRateLabel: string
  gross: number
  commission: number
  net: number
  bookingCount: number
  status: 'pending' | 'paid'
  payDate: string | null
  lines: SettlementLine[]
  /** 송금할 정산 계좌 "은행 계좌번호 (예금주)". 크로스허브만. 미등록이면 null */
  bankAccount: string | null
  /** 수수료 배분 (크로스허브만). 건별 스냅샷의 합. PG 설정이 없으면 pgName null */
  distribution: {
    pgName: string | null
    pgFeeRateLabel: string
    pg: number
    affiliateName: string | null
    affiliateShareRateLabel: string
    affiliate: number
    crosshub: number
  } | null
}

const fromDate = (d: Date) => d.toISOString().slice(0, 10)

/** 정산 계좌 한 줄 "은행 계좌번호 (예금주)". 다 비어 있으면 null (업체·연맹 공통) */
function bankLabel(b: { bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null }): string | null {
  if (!b.bankName && !b.bankAccountNumber) return null
  return [b.bankName, b.bankAccountNumber, b.bankAccountHolder ? `(${b.bankAccountHolder})` : null].filter(Boolean).join(' ')
}

const bookingSelect = {
  id: true,
  partnerId: true,
  amount: true,
  commissionRate: true,
  commission: true,
  net: true,
  cancelFee: true,
  affiliateShareRate: true,
  pgFeeRate: true,
  status: true,
  useDate: true,
  productId: true,
  product: { select: { name: true } },
} satisfies Prisma.BookingSelect
type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

/** 예약 한 건이 그 달 정산에 들어가는지, 들어가면 어떤 금액으로 */
// 정산은 이용완료 기준만: 이용일이 그 달인 이용완료 예약(취소는 취소 수수료). 이용완료는 취소할 수 없어서
// 지급완료 뒤 금액이 바뀌지 않는다. (결제일 기준은 지급 뒤 취소되면 차감할 곳이 없어 없앴다)
function toLine(b: BookingRecord, month: string): SettlementLine | null {
  if (fromDate(b.useDate).slice(0, 7) !== month) return null

  const isCancel = b.status === 'canceled' || b.status === 'refunded'
  const common = {
    bookingId: b.id,
    productId: b.productId,
    productName: b.product.name,
    useDate: fromDate(b.useDate),
    status: b.status, // 화면에서 bookings.status.<코드>로 번역
    isCancel,
    commissionRate: b.commissionRate,
    affiliateShareRate: b.affiliateShareRate,
    pgFeeRate: b.pgFeeRate,
  }
  // 배분은 정산 기준 금액에 예약 때 박힌 요율을 곱한다 (업체 수수료와 같은 반올림)
  const shares = (base: number) => ({ affiliate: Math.round((base * b.affiliateShareRate) / 100), pg: Math.round((base * b.pgFeeRate) / 100) })
  if (isCancel) {
    const fee = b.cancelFee ?? 0
    if (fee <= 0) return null
    return { ...common, base: fee, ...splitAmount(fee, b.commissionRate), ...shares(fee) }
  }
  if (b.status === 'completed') {
    return { ...common, base: b.amount, commission: b.commission, net: b.net, ...shares(b.amount) }
  }
  return null
}

async function aggregate(partnerIds: string[], month: string, forCrosshub: boolean): Promise<SettlementRow[]> {
  return (await aggregateMonths(partnerIds, [month], forCrosshub)).get(month) ?? []
}

/** 여러 달 정산을 한 번에. 예약·정산 행은 첫 달~마지막 달 범위로 한 번만 읽고, 달마다 나눠 계산한다 (통계처럼 여러 달을 볼 때) */
async function aggregateMonths(partnerIds: string[], months: string[], forCrosshub: boolean): Promise<Map<string, SettlementRow[]>> {
  const sorted = [...months].sort()
  const lastStart = new Date(`${sorted[sorted.length - 1]}-01T00:00:00Z`)
  const monthStart = new Date(`${sorted[0]}-01T00:00:00Z`)
  const monthEnd = new Date(Date.UTC(lastStart.getUTCFullYear(), lastStart.getUTCMonth() + 1, 1))

  const [partners, settings, bookings, settlements] = await Promise.all([
    prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: {
        id: true,
        name: true,
        currency: true,
        commissionRate: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountHolder: true,
        proxyAffiliate: { select: { name: true, shareRate: true } },
      },
      orderBy: { name: 'asc' },
    }),
    pgSettingMap(),
    prisma.booking.findMany({
      where: {
        partnerId: { in: partnerIds },
        status: { in: ['completed', 'canceled', 'refunded'] },
        useDate: { gte: monthStart, lt: monthEnd },
      },
      select: bookingSelect,
      orderBy: [{ useDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.settlement.findMany({ where: { period: { in: sorted }, partnerId: { in: partnerIds } } }),
  ])

  return new Map(sorted.map((month) => [month, monthRows(month)]))

  function monthRows(month: string): SettlementRow[] {
    return partners.map((p) => {
      const setting = settings.get(p.currency)
      const lines = bookings.filter((b) => b.partnerId === p.id).map((b) => toLine(b, month)).filter((l): l is SettlementLine => !!l)
      const paid = settlements.find((s) => s.partnerId === p.id && s.period === month)

      // 지급완료면 그때 굳힌 숫자, 아니면 지금 예약 기준으로 계산한 숫자
      const gross = paid ? paid.gross : lines.reduce((sum, l) => sum + l.base, 0)
      const commission = paid ? paid.commission : lines.reduce((sum, l) => sum + l.commission, 0)
      const net = paid ? paid.net : lines.reduce((sum, l) => sum + l.net, 0)
      const bookingCount = paid ? paid.bookingCount : lines.length

      // 배분은 건별 스냅샷의 합. 지급완료 뒤에도 건은 그대로라 같은 숫자가 나온다
      let distribution: SettlementRow['distribution'] = null
      if (forCrosshub) {
        const pg = lines.reduce((sum, l) => sum + l.pg, 0)
        const affiliate = lines.reduce((sum, l) => sum + l.affiliate, 0)
        distribution = {
          pgName: setting?.pgName ?? null,
          pgFeeRateLabel: rateLabel(lines.map((l) => l.pgFeeRate)) ?? String(setting?.feeRate ?? 0),
          pg,
          affiliateName: p.proxyAffiliate?.name ?? null,
          affiliateShareRateLabel: rateLabel(lines.map((l) => l.affiliateShareRate)) ?? String(p.proxyAffiliate?.shareRate ?? 0),
          affiliate,
          crosshub: commission - pg - affiliate,
        }
      }

      return {
        partnerId: p.id,
        partnerName: p.name,
        currency: p.currency,
        commissionRateLabel: rateLabel(lines.map((l) => l.commissionRate)) ?? (p.commissionRate == null ? '-' : String(p.commissionRate)),
        gross,
        commission,
        net,
        bookingCount,
        status: paid ? 'paid' : 'pending',
        payDate: paid?.payDate ? fromDate(paid.payDate) : null,
        lines,
        bankAccount: forCrosshub ? bankLabel(p) : null,
        distribution,
      }
    })
  }
}

/** 그 달의 업체별 정산. 크로스허브는 전체(업체 전환 시 그 업체), 연맹은 대행 업체, 업체는 자기 업체 */
export async function listMonthlySettlements(user: SessionUser, month: string): Promise<SettlementRow[]> {
  return aggregate(visiblePartnerIds(user), month, user.role === 'crosshub')
}

/** 여러 달의 업체별 정산 (통계의 수익). 달마다 따로 계산하지 않고 한 번에 읽어 달 → 업체별 행으로 돌려준다 */
export async function listSettlementsForMonths(user: SessionUser, months: string[]): Promise<Map<string, SettlementRow[]>> {
  if (months.length === 0) return new Map()
  return aggregateMonths(visiblePartnerIds(user), months, user.role === 'crosshub')
}

type Result = { ok: true } | { ok: false; error: ErrorKey }

/** 정산 행은 지급완료일 때만 있다(지급완료 취소 = 행 삭제). 그래서 지급은 create로만 하고, 거의 동시에 들어온
 *  두 번째 요청은 유니크 제약(업체+달, 연맹+달+통화)에 걸린 것을 "이미 지급완료"로 돌려준다 */
async function createOnce(tx: Prisma.PrismaPromise<unknown>[]): Promise<Result> {
  try {
    await prisma.$transaction(tx)
    return { ok: true }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, error: 'alreadyPaid' }
    throw e
  }
}

/** 그 달 이용일인데 아직 확정(이용완료 전)인 예약이 있는지. 있으면 지금 굳히면 그 건이 어느 달에도 안 잡힌다 */
async function hasUnfinishedBookings(partnerIds: string[], month: string): Promise<boolean> {
  const start = new Date(`${month}-01T00:00:00Z`)
  const end = new Date(`${shiftMonth(month, 1)}-01T00:00:00Z`)
  const count = await prisma.booking.count({
    where: { partnerId: { in: partnerIds }, status: 'confirmed', useDate: { gte: start, lt: end } },
  })
  return count > 0
}

/** 지급완료 처리. 크로스허브만. 지금 계산된 금액을 Settlement 행에 굳힌다 */
export async function markSettlementPaid(user: SessionUser, partnerId: string, period: string, payDate: string): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  if (!isMonthEnded(period)) return { ok: false, error: 'monthNotEnded' }
  if (await hasUnfinishedBookings([partnerId], period)) return { ok: false, error: 'unfinishedBookings' }
  const [row] = await aggregate([partnerId], period, false)
  if (!row) return { ok: false, error: 'notFound' }
  if (row.status === 'paid') return { ok: false, error: 'alreadyPaid' }

  // Settlement.commissionRate는 정수 한 칸이라, 섞인 달은 건별 내역이 진실이고 여기엔 첫 요율만 남긴다
  const data = {
    gross: row.gross,
    commissionRate: Number.parseInt(row.commissionRateLabel, 10) || 0,
    commission: row.commission,
    net: row.net,
    bookingCount: row.bookingCount,
    status: 'paid' as const,
    payDate: new Date(`${payDate}T00:00:00Z`),
  }
  return createOnce([
    prisma.settlement.create({ data: { partnerId, period, ...data } }),
    audit({ userId: user.id, action: 'settlement_pay', partnerId, targetId: period, targetName: row.partnerName, detail: { period: [null, period], payDate: [null, payDate], net: [null, row.net] } }),
  ])
}

// ── 연맹 지급 ──────────────────────────────────────────────────────────────
// 연맹 몫 = 대행 업체 예약마다 (정산 기준 금액 × 예약 때 박힌 연맹 몫 %p)의 합 (업체 행의 배분 줄과 같은 숫자).
// 업체 지급과 따로 월 1회. 업체 행이 다 지급완료가 아니어도 지급할 수 있다

export type AffiliateSettlementRow = {
  affiliateId: string
  affiliateName: string
  currency: string
  /** 그 달 예약들의 연맹 몫 %p. 섞이면 "4~5". 건이 없으면 지금 설정값 */
  shareRateLabel: string
  amount: number
  partnerCount: number
  status: 'pending' | 'paid'
  payDate: string | null
  /** 연맹 몫을 송금할 계좌 "은행 계좌번호 (예금주)". 미등록이면 null */
  bankAccount: string | null
}

const affiliateSelect = {
  id: true,
  name: true,
  shareRate: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountHolder: true,
  proxyPartners: { select: { id: true } },
} satisfies Prisma.AffiliateSelect
type AffiliateRecord = Prisma.AffiliateGetPayload<{ select: typeof affiliateSelect }>

async function aggregateAffiliates(affiliates: AffiliateRecord[], month: string): Promise<AffiliateSettlementRow[]> {
  const partnerIds = affiliates.flatMap((a) => a.proxyPartners.map((p) => p.id))
  const [partnerRows, saved] = await Promise.all([
    partnerIds.length ? aggregate(partnerIds, month, false) : Promise.resolve([]),
    prisma.affiliateSettlement.findMany({ where: { period: month, affiliateId: { in: affiliates.map((a) => a.id) } } }),
  ])

  const rows: AffiliateSettlementRow[] = []
  for (const a of affiliates) {
    const mine = partnerRows.filter((r) => a.proxyPartners.some((p) => p.id === r.partnerId))
    // 대행 업체 통화가 섞이면 통화마다 1행
    for (const currency of [...new Set(mine.map((r) => r.currency))]) {
      const rs = mine.filter((r) => r.currency === currency)
      const lines = rs.flatMap((r) => r.lines)
      const paid = saved.find((s) => s.affiliateId === a.id && s.currency === currency)
      rows.push({
        affiliateId: a.id,
        affiliateName: a.name,
        currency,
        shareRateLabel: rateLabel(lines.map((l) => l.affiliateShareRate)) ?? String(a.shareRate ?? 0),
        amount: paid ? paid.amount : lines.reduce((sum, l) => sum + l.affiliate, 0),
        partnerCount: paid ? paid.partnerCount : rs.filter((r) => r.gross > 0).length,
        status: paid ? 'paid' : 'pending',
        payDate: paid?.payDate ? fromDate(paid.payDate) : null,
        bankAccount: bankLabel(a),
      })
    }
  }
  return rows
}

/** 그 달의 연맹 몫. 크로스허브는 연맹 전체, 연맹은 자기 것만, 업체는 없음 */
export async function listAffiliateSettlements(user: SessionUser, month: string): Promise<AffiliateSettlementRow[]> {
  if (user.role === 'partner') return []
  if (user.role === 'affiliate' && !user.affiliateId) return []
  const affiliates = await prisma.affiliate.findMany({
    where: user.role === 'affiliate' ? { id: user.affiliateId! } : {},
    select: affiliateSelect,
    orderBy: { name: 'asc' },
  })
  return aggregateAffiliates(affiliates, month)
}

/** 연맹 지급완료 처리. 크로스허브만. 지금 계산된 연맹 몫을 굳힌다 */
export async function markAffiliateSettlementPaid(user: SessionUser, affiliateId: string, period: string, currency: string, payDate: string): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  if (!isMonthEnded(period)) return { ok: false, error: 'monthNotEnded' }
  const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: affiliateSelect })
  if (!affiliate) return { ok: false, error: 'notFound' }
  if (await hasUnfinishedBookings(affiliate.proxyPartners.map((p) => p.id), period)) return { ok: false, error: 'unfinishedBookings' }
  const row = (await aggregateAffiliates([affiliate], period)).find((r) => r.currency === currency)
  if (!row) return { ok: false, error: 'notFound' }
  if (row.status === 'paid') return { ok: false, error: 'alreadyPaid' }

  const data = { amount: row.amount, partnerCount: row.partnerCount, status: 'paid' as const, payDate: new Date(`${payDate}T00:00:00Z`) }
  return createOnce([
    prisma.affiliateSettlement.create({ data: { affiliateId, period, currency, ...data } }),
    audit({
      userId: user.id,
      action: 'settlement_affiliate_pay',
      partnerId: null,
      targetId: period,
      targetName: affiliate.name,
      detail: { period: [null, period], currency: [null, currency], payDate: [null, payDate], amount: [null, row.amount] },
    }),
  ])
}

export async function unmarkAffiliateSettlementPaid(user: SessionUser, affiliateId: string, period: string, currency: string): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  const existing = await prisma.affiliateSettlement.findUnique({
    where: { affiliateId_period_currency: { affiliateId, period, currency } },
    include: { affiliate: { select: { name: true } } },
  })
  if (!existing) return { ok: false, error: 'notFound' }
  await prisma.$transaction([
    prisma.affiliateSettlement.delete({ where: { id: existing.id } }),
    audit({
      userId: user.id,
      action: 'settlement_affiliate_unpay',
      partnerId: null,
      targetId: period,
      targetName: existing.affiliate.name,
      detail: { period: [period, null], currency: [currency, null], payDate: [existing.payDate ? fromDate(existing.payDate) : null, null] },
    }),
  ])
  return { ok: true }
}

/** 지급완료 취소. 행을 지워 다시 예약 기준으로 계산되게 한다 */
export async function unmarkSettlementPaid(user: SessionUser, partnerId: string, period: string): Promise<Result> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  const existing = await prisma.settlement.findUnique({ where: { partnerId_period: { partnerId, period } }, include: { partner: { select: { name: true } } } })
  if (!existing) return { ok: false, error: 'notFound' }
  await prisma.$transaction([
    prisma.settlement.delete({ where: { id: existing.id } }),
    audit({ userId: user.id, action: 'settlement_unpay', partnerId, targetId: period, targetName: existing.partner.name, detail: { period: [period, null], payDate: [existing.payDate ? fromDate(existing.payDate) : null, null] } }),
  ])
  return { ok: true }
}

export type PendingSettlementRow = {
  id: string
  partnerName: string
  period: string
  currency: string
  gross: number
  commission: number
  /** "15" 또는 업체 안에서 섞이면 "12~15" */
  commissionRate: string
  net: number
}

/** 대시보드 "정산 요약": 지난달 이용분 중 아직 송금 안 한 업체. 정산 화면과 같은 계산(aggregate)을 쓴다 */
export async function listPendingSettlements(partnerIds: string[]): Promise<PendingSettlementRow[]> {
  const period = shiftMonth(jstToday().slice(0, 7), -1)
  const rows = await aggregate(partnerIds, period, false)
  return rows
    .filter((r) => r.status === 'pending' && r.bookingCount > 0)
    .map((r) => ({
      id: `${r.partnerId}-${period}`,
      partnerName: r.partnerName,
      period,
      currency: r.currency,
      gross: r.gross,
      commission: r.commission,
      commissionRate: r.commissionRateLabel,
      net: r.net,
    }))
}

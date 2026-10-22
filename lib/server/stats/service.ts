import 'server-only'
import { prisma } from '@/lib/db'
import { shiftMonth } from '@/lib/settlements'
import { type SessionUser, visiblePartnerIds } from '@/lib/server/auth/session'
import { BUSINESS_TIME_ZONE } from '@/lib/datetime'
import { productNameLocalizer } from '@/lib/server/products/translations'

// 판매 통계. 기간(from~to, 일본 시간)은 예약 접수일 기준이고 판매 = 확정·이용완료 예약.
// 카드·추이·표·수익이 모두 같은 기준이라 카드 = 추이 합 = 표 합. 수익은 그 판매 건들의 계정별 몫 (예약 때 박힌 요율).
// 증감은 기간이 걸친 달 수만큼 앞의 같은 날짜와 비교 (이번 달 1~15일 ↔ 지난달 1~15일). 범위는 로그인 계정이 다룰 수 있는 업체 (visiblePartnerIds).
// 금액은 통화별로 따로 더한다 (환산 없음)

export type StatsFilter = { from: string; to: string }

export type StatsData = {
  /** 증감 비교 기간 (걸친 달 수만큼 앞의 같은 날짜) */
  prev: StatsFilter
  /** 추이 단위. 62일 이하면 일별, 넘으면 월별 */
  bucket: 'day' | 'month'
  /** 기간 안 추이: 칸(날짜 또는 YYYY-MM)별 통화별 판매금액·판매 건수·많이 팔린 상품 3개 */
  series: { key: string; amount: Record<string, number>; sold: Record<string, number>; top: Record<string, { name: string; nameAi: boolean; count: number }[]> }[]
  /** 판매(확정·이용완료) 건수와 취소·환불 건수 */
  soldTotal: number
  prevSoldTotal: number
  canceledTotal: number
  /** 통화별 판매금액 (prev = 직전 기간) */
  sales: { currency: string; amount: number; prevAmount: number }[]
  /** 수익: 판매 건들의 "이 계정의 몫" 합. 통화별.
   *  업체 = 정산액(판매가 − 수수료), 연맹 = 연맹 몫, 크로스허브 = 수수료 − PG − 연맹 몫 (정산 관리 배분과 같은 계산) */
  settlement: { rows: { currency: string; amount: number; prevAmount: number }[] }
  /** 상품별: 판매(확정·이용완료)·취소(환불 포함) 건수와 판매 금액 */
  products: { id: string; name: string; nameAi: boolean; partner: string; currency: string; sold: number; canceled: number; amount: number }[]
  /** 업체별: 판매·취소(환불 포함) 건수, 판매 금액, 판매 건들의 정산액 */
  partners: { id: string; name: string; currency: string; sold: number; canceled: number; amount: number; settlementNet: number }[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const jstStart = (day: string) => new Date(`${day}T00:00:00+09:00`)
const kstEnd = (day: string) => new Date(jstStart(day).getTime() + DAY_MS)
const shiftDay = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)

const SOLD: readonly string[] = ['confirmed', 'completed']

const lastDayOf = (month: string) => shiftDay(`${shiftMonth(month, 1)}-01`, -1)
/** 같은 날짜를 n달 전으로. 그 달에 없는 날(31일 등)·말일은 그 달 말일로 */
function dayMonthsBefore(day: string, n: number): string {
  const month = shiftMonth(day.slice(0, 7), -n)
  const last = lastDayOf(month)
  const same = `${month}-${day.slice(8)}`
  return day === lastDayOf(day.slice(0, 7)) || same > last ? last : same
}

/** 증감 비교 기간: 기간이 걸친 달 수만큼 앞의 같은 날짜 (10/1~15 → 9/1~15, 5/1~10/15 → 11/1~4/15) */
function previousRange(filter: StatsFilter): StatsFilter {
  const months = (Number(filter.to.slice(0, 4)) - Number(filter.from.slice(0, 4))) * 12 + Number(filter.to.slice(5, 7)) - Number(filter.from.slice(5, 7)) + 1
  return { from: dayMonthsBefore(filter.from, months), to: dayMonthsBefore(filter.to, months) }
}

export async function getStats(user: SessionUser, filter: StatsFilter, locale: string): Promise<StatsData> {
  const partnerIds = visiblePartnerIds(user)
  const days = Math.round((Date.parse(filter.to) - Date.parse(filter.from)) / DAY_MS) + 1
  const prev = previousRange(filter)
  const current = { gte: jstStart(filter.from), lt: kstEnd(filter.to) }

  // 판매는 DB에서 날짜(일본 시간)·상품별로 합산해 결과 행만 받는다. 직전 기간까지 한 번에 읽고 날짜로 나눈다
  // 몫 배분은 정산과 같게 건마다 판매가 × 예약 때 요율을 반올림해서 더한다
  const [partners, soldRows, productGroups] = await Promise.all([
    prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, name: true, currency: true },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<
      { day: string; currency: string; partnerId: string; productId: string; count: bigint; amount: bigint; net: bigint; commission: bigint; affiliate: number; pg: number }[]
    >`
      SELECT to_char(b."requestedAt" AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD') AS day, pa.currency, b."partnerId", b."productId",
        COUNT(*) AS count, SUM(b.amount) AS amount, SUM(b.net) AS net, SUM(b.commission) AS commission,
        SUM(ROUND(b.amount * b."affiliateShareRate" / 100.0))::float8 AS affiliate,
        SUM(ROUND((b.amount * b."pgFeeRate" / 100.0)::numeric))::float8 AS pg
      FROM "Booking" b
        JOIN "Partner" pa ON pa.id = b."partnerId"
      WHERE b."partnerId" = ANY(${partnerIds}) AND b.status IN ('confirmed', 'completed')
        AND b."requestedAt" >= ${jstStart(prev.from)} AND b."requestedAt" < ${current.lt}
      GROUP BY 1, 2, 3, 4`,
    prisma.booking.groupBy({
      by: ['productId', 'status'],
      where: { partnerId: { in: partnerIds }, requestedAt: current, status: { in: ['confirmed', 'completed', 'canceled', 'refunded'] } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ])
  const partnerById = new Map(partners.map((p) => [p.id, p]))
  const productInfo = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: [...new Set([...productGroups.map((g) => g.productId), ...soldRows.map((r) => r.productId)])] } },
        select: { id: true, name: true, partnerId: true },
      })
    ).map((p) => [p.id, { ...p, nameAi: false }]),
  )
  // 상품명은 보는 사람 언어로 (AI 번역이면 nameAi)
  const trName = await productNameLocalizer([...productInfo.keys()], locale)
  for (const p of productInfo.values()) {
    const n = trName(p.id, p.name)
    productInfo.set(p.id, { ...p, name: n.name, nameAi: n.ai })
  }

  // 추이 칸: 일별이면 날짜, 월별이면 YYYY-MM. 라벨은 화면에서 언어에 맞춰 만든다
  const bucket: StatsData['bucket'] = days <= 62 ? 'day' : 'month'
  const keyOf = (day: string) => (bucket === 'day' ? day : day.slice(0, 7))
  const series: StatsData['series'] = []
  if (bucket === 'day') {
    for (let d = filter.from; d <= filter.to; d = shiftDay(d, 1)) series.push({ key: d, amount: {}, sold: {}, top: {} })
  } else {
    for (let m = filter.from.slice(0, 7); m <= filter.to.slice(0, 7); m = shiftMonth(m, 1)) series.push({ key: m, amount: {}, sold: {}, top: {} })
  }
  const seriesByKey = new Map(series.map((s) => [s.key, s]))

  const sales = new Map<string, StatsData['sales'][number]>()
  const salesOf = (currency: string) => {
    let s = sales.get(currency)
    if (!s) sales.set(currency, (s = { currency, amount: 0, prevAmount: 0 }))
    return s
  }
  const settlement = new Map<string, StatsData['settlement']['rows'][number]>()
  const settlementRow = (currency: string) => {
    let row = settlement.get(currency)
    if (!row) settlement.set(currency, (row = { currency, amount: 0, prevAmount: 0 }))
    return row
  }
  const share = (r: (typeof soldRows)[number]) =>
    user.role === 'partner' ? Number(r.net) : user.role === 'affiliate' ? r.affiliate : Number(r.commission) - r.pg - r.affiliate
  const partnerSettlement = new Map<string, number>()
  let soldTotal = 0
  let prevSoldTotal = 0
  const topCounts = new Map<string, Map<string, number>>() // `${칸}|${통화}` → 상품 → 건수
  for (const r of soldRows) {
    const count = Number(r.count)
    const amount = Number(r.amount)
    if (r.day < filter.from) {
      if (r.day > prev.to) continue // 비교 기간과 기간 사이
      salesOf(r.currency).prevAmount += amount
      settlementRow(r.currency).prevAmount += share(r)
      prevSoldTotal += count
      continue
    }
    salesOf(r.currency).amount += amount
    settlementRow(r.currency).amount += share(r)
    partnerSettlement.set(r.partnerId, (partnerSettlement.get(r.partnerId) ?? 0) + Number(r.net))
    soldTotal += count
    const s = seriesByKey.get(keyOf(r.day))
    if (!s) continue
    s.amount[r.currency] = (s.amount[r.currency] ?? 0) + amount
    s.sold[r.currency] = (s.sold[r.currency] ?? 0) + count
    const k = `${s.key}|${r.currency}`
    const byProduct = topCounts.get(k) ?? new Map<string, number>()
    byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + count)
    topCounts.set(k, byProduct)
  }
  // 판매가 하나도 없어도 판매금액 카드는 0으로 보인다
  if (sales.size === 0) {
    salesOf(partners[0]?.currency ?? 'JPY')
    settlementRow(partners[0]?.currency ?? 'JPY')
  }
  for (const [k, byProduct] of topCounts) {
    const [key, currency] = k.split('|')
    seriesByKey.get(key)!.top[currency] = [...byProduct]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => ({ name: productInfo.get(id)?.name ?? '-', nameAi: productInfo.get(id)?.nameAi ?? false, count }))
  }

  const productMap = new Map<string, StatsData['products'][number]>()
  const partnerSales = new Map<string, { sold: number; canceled: number; amount: number }>()
  let canceledTotal = 0
  for (const g of productGroups) {
    const info = productInfo.get(g.productId)
    const partner = info && partnerById.get(info.partnerId)
    if (!info || !partner) continue
    const count = g._count._all
    const product = productMap.get(g.productId) ?? {
      id: g.productId,
      name: info.name,
      nameAi: info.nameAi,
      partner: partner.name,
      currency: partner.currency,
      sold: 0,
      canceled: 0,
      amount: 0,
    }
    const ps = partnerSales.get(partner.id) ?? { sold: 0, canceled: 0, amount: 0 }
    for (const row of [product, ps]) {
      if (SOLD.includes(g.status)) {
        row.sold += count
        row.amount += g._sum.amount ?? 0
      } else row.canceled += count // 취소 = 환불 (환불완료도 취소로 센다)
    }
    if (!SOLD.includes(g.status)) canceledTotal += count
    productMap.set(g.productId, product)
    partnerSales.set(partner.id, ps)
  }

  return {
    prev,
    bucket,
    series,
    soldTotal,
    prevSoldTotal,
    canceledTotal,
    sales: [...sales.values()],
    settlement: { rows: [...settlement.values()] },
    products: [...productMap.values()].sort((a, b) => b.sold - a.sold || b.amount - a.amount),
    partners: partners.map((p) => ({
      id: p.id,
      name: p.name,
      currency: p.currency,
      ...(partnerSales.get(p.id) ?? { sold: 0, canceled: 0, amount: 0 }),
      settlementNet: partnerSettlement.get(p.id) ?? 0,
    })),
  }
}

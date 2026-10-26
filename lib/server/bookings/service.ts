import 'server-only'
import { backend, BackendError, qs, seg } from '@/lib/api/backend'
import { prisma } from '@/lib/db'
import { Prisma, type BookingStatus as DbBookingStatus, type CustomerDecision as DbCustomerDecision } from '@/lib/generated/prisma/client'
import { PAGE_SIZE } from '@/lib/pagination'
import { ACTIVE_BOOKING_STATUSES, BOOKING_STATUS_LABEL, CONFIRM_LABEL, DECISION_LABEL } from '@/lib/bookings/status'
import { cancelFeeFor, daysBetween } from '@/lib/fees'
import type { CancelRule } from '@/lib/products/types'
import type { PriceBreakdown } from '@/lib/bookings/types'
import { resolve as resolveSchedule, type SaleSchedule } from '@/lib/products/schedule'
import { jstToday } from '@/lib/settlements'
import { productNameLocalizer, productTextLocalizer } from '@/lib/server/products/translations'
import type { SessionUser } from '@/lib/server/auth/session'

// 예약 업무 로직. 업체 범위(partnerIds)는 호출하는 쪽이 세션에서 구해 넘긴다 (visiblePartnerIds).
// 화면은 기존 프로토타입(lib/mock-data.ts의 Booking)과 같은 한글 라벨 값을 그대로 쓰므로,
// DB enum ↔ 한글 라벨 변환은 전부 이 서비스 안에서 끝낸다 — bookings-view.tsx는 한 글자도 안 바뀐다.

const STATUS_LABEL = BOOKING_STATUS_LABEL

/** searchParams로 들어온 status 문자열이 실제 예약 상태 enum인지 확인 (url 조작 방어) */
export function isBookingStatus(value: string | undefined): value is DbBookingStatus {
  return !!value && value in STATUS_LABEL
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`)
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

function toBookingRow<
  T extends {
    id: string
    productId: string
    customerName: string
    phone: string | null
    email: string | null
    nationality: string
    useDate: Date
    people: number
    amount: number
    commissionRate: number
    commission: number
    net: number
    cancelFee: number | null
    cancelReason: string | null
    priceBreakdown: unknown
    status: DbBookingStatus
    confirmType: 'instant' | 'quote'
    requestedAt: Date
    quoteAmount: number | null
    quoteMessage: string | null
    customerDecision: DbCustomerDecision | null
    product: { name: string; cancelRules: unknown; partner: { name: string; currency: string } }
  },
>(b: T) {
  return {
    id: b.id,
    productId: b.productId,
    productName: b.product.name,
    /** productName이 보는 사람 언어의 AI 번역이면 true (localizeBookingRows가 채운다) */
    productNameAi: false,
    partner: b.product.partner.name,
    currency: b.product.partner.currency,
    customerName: b.customerName,
    phone: b.phone ?? undefined,
    email: b.email ?? undefined,
    nationality: b.nationality,
    useDate: fromDate(b.useDate),
    people: b.people,
    amount: b.amount,
    // 금액 3종 스냅샷 (판매가·수수료·정산액) + 취소 수수료. 확정 상태면 "지금 취소하면 얼마"를 미리 계산해 준다
    commissionRate: b.commissionRate,
    commission: b.commission,
    net: b.net,
    cancelFee: b.cancelFee,
    cancelReason: b.cancelReason,
    cancelFeePreview: b.status === 'confirmed' ? cancelFeeNow(b.amount, b.product.cancelRules, b.useDate) : null,
    priceBreakdown: (b.priceBreakdown as PriceBreakdown | null) ?? undefined,
    status: STATUS_LABEL[b.status],
    confirmType: CONFIRM_LABEL[b.confirmType],
    requestedAt: b.requestedAt.toISOString(), // 화면에서 JST로 표시
    quoteAmount: b.quoteAmount ?? undefined,
    quoteMessage: b.quoteMessage ?? undefined,
    customerDecision: b.customerDecision ? DECISION_LABEL[b.customerDecision] : undefined,
  }
}

export type BookingRow = ReturnType<typeof toBookingRow>

/** 상품명·플랜·인원 구분·옵션명을 보는 사람 언어로 (상품 번역 기준). 번역이 없으면 원문 그대로 */
export async function localizeBookingRows(rows: BookingRow[], locale: string): Promise<BookingRow[]> {
  const ids = rows.map((r) => r.productId)
  const [tr, trName] = await Promise.all([productTextLocalizer(ids, locale), productNameLocalizer(ids, locale)])
  return rows.map((r) => {
    const pb = r.priceBreakdown
    const name = trName(r.productId, r.productName)
    return {
      ...r,
      productName: name.name,
      productNameAi: name.ai,
      priceBreakdown: pb && {
        ...pb,
        planName: tr(r.productId, pb.planName),
        peopleByCategory: pb.peopleByCategory.map((c) => ({ ...c, categoryName: tr(r.productId, c.categoryName) })),
        selectedOptions: pb.selectedOptions.map((o) => ({ ...o, label: tr(r.productId, o.label) })),
      },
    }
  })
}

const bookingInclude = { product: { select: { name: true, cancelRules: true, partner: { select: { name: true, currency: true } } } } }

/** 오늘 취소하면 내야 할 취소 수수료 (상품의 cancelRules, 이용일까지 남은 날 기준) */
function cancelFeeNow(amount: number, cancelRules: unknown, useDate: Date) {
  const rules = (Array.isArray(cancelRules) ? cancelRules : []) as CancelRule[]
  return cancelFeeFor(amount, rules, daysBetween(jstToday(), fromDate(useDate)))
}

// status 'active' = 진행 중(업체확인중·고객확인중·확정·취소) 묶음
export type BookingListParams = { page: number; keyword?: string; status?: DbBookingStatus | 'active'; productId?: string }

/** BE(/api/v1/bookings) 요약 응답 모양. BookingDetailResponse와 거의 같은 필드 + productCancelRules(취소수수료 미리보기용). */
type BeBookingSummary = {
  id: string
  productId: string
  productName: string | null
  partnerId: string
  partnerName: string | null
  currency: string | null
  customerName: string
  phone: string | null
  email: string | null
  nationality: string
  useDate: string
  people: number
  amount: number
  commissionRate: number
  commission: number
  net: number
  cancelFee: number | null
  cancelReason: string | null
  priceBreakdown: unknown
  status: DbBookingStatus
  confirmType: 'instant' | 'quote'
  requestedAt: string
  quoteAmount: number | null
  quoteValidUntil: string | null
  quoteMessage: string | null
  customerDecision: DbCustomerDecision | null
  productCancelRules: unknown
}

/**
 * BE는 이미 서버사이드 페이지네이션을 하는데(고정 20개씩) dev 모드에선 호출자 범위를 몰라 항상 전체
 * 기준으로 페이지를 끊는다 — FE가 실제 범위(partnerIds)로 다시 거르면 그 페이지 안에서도 깨진다.
 * 그래서 페이지네이션은 아예 안 쓰고, BE 페이지를 전부 돌아 모은 뒤 필터·정렬·페이지네이션을 FE가 직접 한다
 * (데모 스케일이라 호출 몇 번 더 하는 비용은 미미).
 */
async function fetchAllBookingsFromBe(): Promise<BeBookingSummary[]> {
  const first = await backend.get<{ rows: BeBookingSummary[]; total: number; page: number; size: number }>('/api/v1/bookings?page=1')
  const rows = [...first.rows]
  const totalPages = first.size > 0 ? Math.ceil(first.total / first.size) : 1
  for (let page = 2; page <= totalPages; page++) {
    const next = await backend.get<{ rows: BeBookingSummary[]; total: number; page: number; size: number }>(`/api/v1/bookings${qs({ page })}`)
    rows.push(...next.rows)
  }
  return rows
}

/** BE의 평평한 요약 행을 toBookingRow()가 기대하는 모양(product 중첩)으로 되돌린다 — 라벨 변환·취소수수료
 *  미리보기 로직을 한 글자도 다시 안 짜고 그대로 재사용하려고. */
function toBookingRowInput(r: BeBookingSummary) {
  return {
    id: r.id,
    productId: r.productId,
    customerName: r.customerName,
    phone: r.phone,
    email: r.email,
    nationality: r.nationality,
    useDate: new Date(`${r.useDate}T00:00:00Z`),
    people: r.people,
    amount: r.amount,
    commissionRate: r.commissionRate,
    commission: r.commission,
    net: r.net,
    cancelFee: r.cancelFee,
    cancelReason: r.cancelReason,
    priceBreakdown: r.priceBreakdown,
    status: r.status,
    confirmType: r.confirmType,
    requestedAt: new Date(r.requestedAt),
    quoteAmount: r.quoteAmount,
    quoteMessage: r.quoteMessage,
    customerDecision: r.customerDecision,
    product: {
      name: r.productName ?? '',
      cancelRules: r.productCancelRules,
      partner: { name: r.partnerName ?? '', currency: r.currency ?? '' },
    },
  }
}

// statusCounts: 진행 중 상태 칩에 붙일 상태별 건수. 검색어·업체·상품 조건은 따르고 상태 조건만 빼고 센다
export async function listBookings(
  partnerIds: string[],
  params: BookingListParams,
): Promise<{ rows: BookingRow[]; total: number; statusCounts: Partial<Record<DbBookingStatus, number>> }> {
  const keyword = params.keyword?.trim()

  const beRows = await fetchAllBookingsFromBe()
  // 업체범위는 BE가 dev 모드에서 못 걸러서 FE가 직접 (products와 동일한 이유 — Keycloak 붙으면 BE가 대신 걺)
  let scoped = beRows.filter((r) => partnerIds.includes(r.partnerId))

  if (params.productId) scoped = scoped.filter((r) => r.productId === params.productId)

  if (keyword) {
    const kw = keyword.toLowerCase()
    const directMatchIds = new Set(
      scoped
        .filter((r) => r.id.toLowerCase().includes(kw) || r.customerName.toLowerCase().includes(kw) || (r.productName ?? '').toLowerCase().includes(kw))
        .map((r) => r.id),
    )
    // 상품명 검색은 번역된 이름도 매칭 (productNameSearch와 동일 조건, products의 하이브리드와 같은 패턴)
    const translatedMatches = await prisma.productTranslation.findMany({
      where: { productId: { in: [...new Set(scoped.map((r) => r.productId))] }, texts: { path: ['name'], string_contains: keyword } },
      select: { productId: true },
    })
    const matchedProductIds = new Set(translatedMatches.map((t) => t.productId))
    scoped = scoped.filter((r) => directMatchIds.has(r.id) || matchedProductIds.has(r.productId))
  }

  // statusCounts는 상태 필터 적용 전(업체범위·상품·키워드만 적용된) 집합 기준 — BE 데이터만으로 계산 가능(prisma 불필요)
  const statusCounts: Partial<Record<DbBookingStatus, number>> = {}
  for (const status of ACTIVE_BOOKING_STATUSES) {
    const count = scoped.filter((r) => r.status === status).length
    if (count > 0) statusCounts[status] = count
  }

  const statusFiltered =
    params.status === 'active'
      ? scoped.filter((r) => ACTIVE_BOOKING_STATUSES.includes(r.status))
      : params.status
        ? scoped.filter((r) => r.status === params.status)
        : scoped

  // 정렬: 진행 중(묶음·개별 상태)은 곧 이용할 예약부터(이용일 빠른 순), 종료 상태는 최근 기록부터(이용일 최근 순).
  // 이용일이 같으면 먼저 접수된 예약이 위
  const upcomingFirst = params.status === 'active' || (params.status !== undefined && ACTIVE_BOOKING_STATUSES.includes(params.status))
  const sorted = [...statusFiltered].sort((a, b) => {
    const dateDiff = upcomingFirst ? Date.parse(a.useDate) - Date.parse(b.useDate) : Date.parse(b.useDate) - Date.parse(a.useDate)
    return dateDiff !== 0 ? dateDiff : Date.parse(a.requestedAt) - Date.parse(b.requestedAt)
  })

  const total = sorted.length
  const pageRows = sorted.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE)
  return { rows: pageRows.map((r) => toBookingRow(toBookingRowInput(r))), total, statusCounts }
}

/** 대시보드용: 업체가 견적을 보내야 하는(업체확인중) 예약 + 환불 처리할(환불대기) 예약. 각각 오래된 순 상위 N건 + 전체 건수.
 *  고객확인중은 고객 차례라 업체 할 일에서 뺀다 */
export async function listNeedsAttentionBookings(
  partnerIds: string[],
  limit = 5,
): Promise<{ rows: BookingRow[]; total: number; refundRows: BookingRow[]; refundTotal: number }> {
  const scope = { partnerId: { in: partnerIds } }
  const where: Prisma.BookingWhereInput = { ...scope, status: 'pending' }
  const refundWhere: Prisma.BookingWhereInput = { ...scope, status: 'canceled' }
  const [rows, total, refundRows, refundTotal] = await Promise.all([
    prisma.booking.findMany({ where, include: bookingInclude, orderBy: { requestedAt: 'asc' }, take: limit }),
    prisma.booking.count({ where }),
    // 취소 시각은 따로 저장하지 않아서, 마지막으로 바뀐 순(= 취소된 순)으로 본다
    prisma.booking.findMany({ where: refundWhere, include: bookingInclude, orderBy: { updatedAt: 'asc' }, take: 3 }),
    prisma.booking.count({ where: refundWhere }),
  ])
  return { rows: rows.map(toBookingRow), total, refundRows: refundRows.map(toBookingRow), refundTotal }
}

type MutationResult = { ok: true } | { ok: false; error: 'notFound' | 'invalidAmount' | 'tooLong' }

/**
 * 업체가 고객 신청에 견적서를 보낸다. 업체확인중일 때만. 소유 업체 확인·전환 가능 여부·저장은
 * BE(POST .../quote)가 한다. partnerIds는 이제 안 쓰지만(BE가 토큰으로 직접 범위를 건다),
 * actions.ts 호출부를 안 바꾸려고 시그니처는 그대로 둔다.
 */
export async function sendQuote(id: string, _partnerIds: string[], input: { amount: number; message: string }): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/bookings/${seg(id)}/quote`, input)
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'tooLong') return { ok: false, error: 'tooLong' }
      if (e.code === 'invalidAmount') return { ok: false, error: 'invalidAmount' }
    }
    throw e
  }
}

/**
 * 고객이 견적에 응답한다(지금은 관리자 화면에서 대신 눌러 시뮬레이션). 고객확인중일 때만.
 * 수락 시 결제 행과 업체 계정 알림까지 BE가 같이 남긴다.
 */
export async function respondAsCustomer(id: string, _partnerIds: string[], decision: 'accepted' | 'declined'): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/bookings/${seg(id)}/customer-decision`, { decision })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return { ok: false, error: 'notFound' }
    throw e
  }
}

/**
 * 환불 완료 처리. 취소할 때 취소표로 계산해 둔 수수료를 업체가 확인하고, 필요하면 낮춰서(깎아주기만) 환불한다.
 * 수수료를 올리는 건 막는다 — 고객이 미리 본 취소표보다 더 떼면 분쟁이 된다. 처리·작업 이력은 BE(POST .../refund)가 한다.
 */
export async function completeRefund(_user: SessionUser, id: string, cancelFee: number): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/bookings/${seg(id)}/refund`, { cancelFee })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'tooLong') return { ok: false, error: 'tooLong' }
      if (e.code === 'invalidAmount') return { ok: false, error: 'invalidAmount' }
    }
    throw e
  }
}

/**
 * 견적 거절, 이용완료 처리, 예약 취소. reason은 거절·취소일 때만 쓴다(선택 입력).
 * 허용 전환 판정·취소수수료 계산·저장은 BE(POST .../status)가 한다.
 */
export async function setBookingStatus(id: string, _partnerIds: string[], status: DbBookingStatus, reason?: string): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/bookings/${seg(id)}/status`, { status, reason })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return { ok: false, error: 'notFound' }
    if (e instanceof BackendError && e.code === 'tooLong') return { ok: false, error: 'tooLong' }
    throw e
  }
}

/** schedule이 상품 등록 화면에서 한 번도 설정 안 된 기본값("{}")인지 — 그 경우는 정원 제한 없음으로 본다 */
function isConfiguredSchedule(schedule: unknown): schedule is SaleSchedule {
  return !!schedule && typeof schedule === 'object' && 'base' in (schedule as Record<string, unknown>)
}

export type DateCapacity = { open: boolean; max: number | null; booked: number }

/** 날짜 목록(YYYY-MM-DD)에 대해 그 상품의 정원 규칙(schedule)과 실제 예약 합을 한 번에 구한다.
 *  Booking에 회차(시각)를 저장하지 않아서, 하루에 출발 시각이 여러 개인 상품은 시각별이 아니라 날짜 전체
 *  기준으로만 정원을 본다 (실제보다 더 빡빡하게 볼 수 있음). schedule이 미설정이면 전부 무제한(max: null)으로 본다. */
export async function remainingCapacityForDates(productId: string, schedule: unknown, dates: string[]): Promise<Record<string, DateCapacity>> {
  if (!isConfiguredSchedule(schedule)) {
    return Object.fromEntries(dates.map((d) => [d, { open: true, max: null, booked: 0 }]))
  }

  const grouped = await prisma.booking.groupBy({
    by: ['useDate'],
    where: { productId, useDate: { in: dates.map(toDate) }, status: { notIn: ['rejected', 'canceled', 'refunded', 'withdrawn'] } },
    _sum: { people: true },
  })
  const bookedByDate = new Map(grouped.map((g) => [fromDate(g.useDate), g._sum.people ?? 0]))

  return Object.fromEntries(
    dates.map((d) => {
      const day = resolveSchedule(schedule, d)
      return [d, { open: day.open, max: day.people.maxPeople, booked: bookedByDate.get(d) ?? 0 }]
    }),
  )
}

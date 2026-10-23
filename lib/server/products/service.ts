import 'server-only'
import { after } from 'next/server'
import { backend, BackendError, qs } from '@/lib/api/backend'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import type { Role } from '@/lib/permissions'
import { PAGE_SIZE } from '@/lib/pagination'
import { addDays } from '@/lib/products/jp-calendar'
import { saleRange } from '@/lib/products/schedule'
import { blocksFor, cancelRulesFor, priceTableFor, scheduleFor } from '@/lib/products/validate'
import { priceFrom, type ConfirmType, type ProductCategory, type ProductFull, type ProductInput, type ProductRow, type ProductStatus } from '@/lib/products/types'
import { remainingCapacityForDates, type DateCapacity } from '@/lib/server/bookings/service'
import { partnerStakeholders } from '@/lib/server/notifications/recipients'
import { createNotifications } from '@/lib/server/notifications/service'
import { inspectProductInBackground } from '@/lib/server/inspect/service'
import { productNameSearch, syncProductTranslations, translationsComplete, translationSummary } from './translations'

// 상품 업무 로직. 업체 범위(partnerIds)는 호출하는 쪽이 세션에서 구해 넘긴다 (visiblePartnerIds).

/** 등록·수정할 업체를 정한다. 업체 계정은 자기 업체로 고정, 그 외는 다룰 수 있는 업체(scope) 안에서만. 안 되면 null */
export function partnerForWrite(user: { role: Role; managedPartners: { id: string }[] }, scope: string[], requested: string): string | null {
  const partnerId = user.role === 'partner' ? (user.managedPartners[0]?.id ?? '') : requested
  return partnerId && scope.includes(partnerId) ? partnerId : null
}

/** BE(POST/PUT /api/v1/products)로 보낼 요청 바디. 판매기간(saleStart/End)·priceFrom은 여기서 계산해서
 *  같이 보낸다 — BE는 그대로 저장만 하고 계산은 안 한다(prisma 버전의 columns()와 같은 책임 분담). */
function upsertBody(input: ProductInput) {
  const range = saleRange(input.schedule)
  return {
    partnerId: input.partnerId,
    category: input.category,
    name: input.name,
    images: input.images,
    description: input.description,
    saleStart: range ? range[0] : null,
    saleEnd: range ? range[1] : null,
    deadlineDays: input.deadlineDays,
    deadlineTime: input.deadlineTime,
    confirmType: input.confirmType,
    schedule: input.schedule,
    cancelRules: input.cancelRules,
    priceFrom: priceFrom(input.priceTable),
    priceTable: input.priceTable,
    blocks: input.blocks,
  }
}

// pendingChange: 대기중인 변경요청(수정·삭제·숨김전환)이 있는 상품만. 상품 상태와는 별개라 status와 따로 받는다
export type ProductListParams = { page: number; keyword?: string; status?: ProductStatus; pendingChange?: boolean }

/** BE(/api/v1/products) 요약 응답 모양. partnerName·createdAt·reviewRejectReason은 BE가 이미 채워 준다. */
type BeProductSummary = {
  id: string
  partnerId: string
  partnerName: string | null
  status: string
  category: string
  confirmType: string
  name: string
  thumbnail: string | null
  priceFrom: number | null
  reviewRejectReason: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 목록 기본 컬럼(이름·업체명·가격·등록일 등)은 BE에서 가져온다. 번역 상태·변경요청·번역된 이름 검색은
 * 아직 BE에 없는 서브시스템(ProductTranslation/ProductChangeRequest)이라 prisma를 그대로 쓴다 — 하이브리드.
 * BE는 dev 모드에서 호출자가 누구인지 몰라 항상 전체를 돌려주므로, 업체 범위(partnerIds)는 FE가 직접 거른다.
 */
export async function listProducts(
  partnerIds: string[],
  params: ProductListParams,
): Promise<{ rows: ProductRow[]; total: number; pendingChangeCount: number }> {
  const keyword = params.keyword?.trim()
  // 검색어·업체 조건(baseWhere)은 변경요청 칩 건수에도 그대로 적용한다
  const baseWhere: Prisma.ProductWhereInput = {
    partnerId: { in: partnerIds },
    ...(keyword
      ? { OR: [productNameSearch(keyword), { partner: { name: { contains: keyword, mode: 'insensitive' } } }] }
      : {}),
  }
  const pendingChangeWhere: Prisma.ProductWhereInput = { changeRequests: { some: { status: 'pending' } } }

  const [pendingChangeCount, beRows] = await Promise.all([
    prisma.product.count({ where: { ...baseWhere, ...pendingChangeWhere } }),
    backend.get<BeProductSummary[]>(`/api/v1/products${qs({ status: params.status })}`),
  ])

  // BE가 못 거르는 업체 범위를 FE가 직접 건다 (dev 모드 전체열람 대응 — Keycloak 붙으면 BE가 대신 걺)
  let filtered = beRows.filter((r) => partnerIds.includes(r.partnerId))

  if (keyword) {
    const kw = keyword.toLowerCase()
    const directMatchIds = new Set(
      filtered.filter((r) => r.name.toLowerCase().includes(kw) || (r.partnerName ?? '').toLowerCase().includes(kw)).map((r) => r.id),
    )
    // 번역된 상품명 매칭은 ProductTranslation에만 있어 별도 조회 (productNameSearch의 두 번째 조건과 동일)
    const translatedMatches = await prisma.productTranslation.findMany({
      where: { productId: { in: filtered.map((r) => r.id) }, texts: { path: ['name'], string_contains: keyword } },
      select: { productId: true },
    })
    const matchIds = new Set([...directMatchIds, ...translatedMatches.map((t) => t.productId)])
    filtered = filtered.filter((r) => matchIds.has(r.id))
  }

  if (params.pendingChange) {
    const pending = await prisma.product.findMany({ where: { partnerId: { in: partnerIds }, ...pendingChangeWhere }, select: { id: true } })
    const pendingIds = new Set(pending.map((p) => p.id))
    filtered = filtered.filter((r) => pendingIds.has(r.id))
  }

  // BE도 status로 걸러서 주지만, 방어적으로 한 번 더 (BE가 비워서 주는 경우 대비)
  if (params.status) filtered = filtered.filter((r) => r.status === params.status)

  filtered = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const total = filtered.length
  const pageRows = filtered.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE)
  const pageIds = pageRows.map((r) => r.id)

  // 번역 상태는 이번 페이지 행만 — 여전히 prisma (원문이 바뀐 칸이 있는지 보려면 원문 글도 같이 필요)
  const translationRows = pageIds.length
    ? await prisma.product.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          status: true,
          sourceLocale: true,
          name: true,
          description: true,
          priceTable: true,
          blocks: true,
          translations: { select: { locale: true, texts: true, sources: true, reviewed: true } },
        },
      })
    : []
  const translationById = new Map(translationRows.map((r) => [r.id, translationSummary(r)]))

  const mapped: ProductRow[] = pageRows.map((r) => ({
    id: r.id,
    status: r.status as ProductStatus,
    name: r.name,
    partnerId: r.partnerId,
    partnerName: r.partnerName ?? '',
    priceFrom: r.priceFrom,
    image: r.thumbnail,
    createdAt: r.createdAt,
    reviewRejectReason: r.reviewRejectReason,
    translation: translationById.get(r.id) ?? null,
  }))
  // 번역이 하나도 없는 상품(이 기능 전에 저장된 상품, 번역 실패)은 목록을 연 뒤에 번역을 다시 건다 — 새로고침하면 반영된다
  const untranslated = mapped.filter((r) => r.translation?.state === 'none').map((r) => r.id)
  if (untranslated.length) {
    after(async () => {
      for (const id of untranslated) await syncProductTranslations(id)
    })
  }
  return { pendingChangeCount, rows: mapped, total }
}

/** 크로스허브 대시보드용: 등록심사 상품, 오래 기다린 순 상위 N건 + 전체 건수 */
export async function listReviewProducts(partnerIds: string[], limit = 5) {
  const where: Prisma.ProductWhereInput = { partnerId: { in: partnerIds }, status: 'review' }
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, createdAt: true, partner: { select: { name: true } } },
      take: limit,
    }),
    prisma.product.count({ where }),
  ])
  return { rows: rows.map((r) => ({ id: r.id, name: r.name, nameAi: false, partnerName: r.partner.name, createdAt: r.createdAt.toISOString() })), total }
}

export type ReviewProductRow = Awaited<ReturnType<typeof listReviewProducts>>['rows'][number]

/** 예약 관리 화면의 "상품" 필터 드롭다운용 — 이름·소속 업체만 가볍게 */
export async function listProductOptions(partnerIds: string[]): Promise<{ id: string; name: string; partnerId: string }[]> {
  return prisma.product.findMany({
    where: { partnerId: { in: partnerIds } },
    select: { id: true, name: true, partnerId: true },
    orderBy: { name: 'asc' },
  })
}

/** 변경요청(수정·삭제·숨김전환)으로 보낼지 바로 반영할지 actions.ts가 판단하는 데 필요한 최소 정보 */
export async function productBranchInfo(id: string, partnerIds: string[]): Promise<{ id: string; status: ProductStatus; partnerId: string; name: string } | null> {
  return prisma.product.findFirst({ where: { id, partnerId: { in: partnerIds } }, select: { id: true, status: true, partnerId: true, name: true } })
}

/** BE(/api/v1/products/{id}) 상세 응답 모양. */
type BeProductDetail = {
  id: string
  partnerId: string
  partnerName: string | null
  status: ProductStatus
  category: ProductCategory
  name: string
  images: string[]
  description: string
  deadlineDays: number
  deadlineTime: string
  confirmType: ConfirmType
  schedule: unknown
  cancelRules: unknown
  priceTable: unknown
  blocks: unknown
  createdAt: string
  reviewRejectReason: string | null
}

export async function getProduct(id: string, partnerIds: string[]): Promise<ProductFull | null> {
  let p: BeProductDetail
  try {
    p = await backend.get<BeProductDetail>(`/api/v1/products/${id}`)
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return null
    throw e
  }
  // BE는 dev 모드에서 범위를 못 걸러 항상 돌려주므로, FE가 업체범위를 직접 확인 (products 목록과 동일한 이유)
  if (!partnerIds.includes(p.partnerId)) return null
  return {
    id: p.id,
    status: p.status,
    partnerId: p.partnerId,
    category: p.category,
    partnerName: p.partnerName ?? '',
    name: p.name,
    images: p.images,
    description: p.description,
    deadlineDays: p.deadlineDays,
    deadlineTime: p.deadlineTime,
    confirmType: p.confirmType,
    schedule: scheduleFor(p.schedule),
    cancelRules: cancelRulesFor(p.cancelRules),
    priceTable: priceTableFor(p.priceTable),
    blocks: blocksFor(p.blocks),
    createdAt: p.createdAt,
    reviewRejectReason: p.reviewRejectReason,
  }
}

/** month("YYYY-MM")에 속한 날짜(YYYY-MM-DD) 전부 */
function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: daysInMonth }, (_, i) => addDays(`${month}-01`, i))
}

/** 빠른 보기 모달의 날짜별 정원/잔여 캘린더용 — 그 달 날짜마다 {open, max, booked} */
export async function getProductCapacity(id: string, partnerIds: string[], month: string): Promise<Record<string, DateCapacity> | null> {
  const product = await prisma.product.findFirst({ where: { id, partnerId: { in: partnerIds } }, select: { schedule: true } })
  if (!product) return null
  return remainingCapacityForDates(id, product.schedule, datesInMonth(month))
}

// 새 상품은 항상 심사중으로 시작한다 (크로스허브가 승인해야 노출). 비활성 업체 체크·수수료율 체크는
// 이제 BE(ProductService.create/update/setStatus)가 한다 — isPartnerActive/hasCommissionRate는 더 안 씀.

type CreateResult = { ok: true; id: string } | { ok: false; error: 'partnerInactive' }

/**
 * draft면 임시저장(심사 요청 전), 아니면 바로 심사중. 등록 자체(partner-active 체크·저장·AuditLog)는
 * BE(POST /api/v1/products?draft=)가 한다 — 번역 자동생성·AI 검수는 아직 BE에 없는 서브시스템이라
 * BE가 돌려준 id로 FE가 이어서 건다(기존 동작과 동일, 트리거하는 쪽만 바뀜).
 */
export async function createProduct(actorId: string, input: ProductInput, { draft = false }: { draft?: boolean } = {}): Promise<CreateResult> {
  let created: { id: string }
  try {
    created = await backend.post<{ id: string }>(`/api/v1/products${qs({ draft: draft ? 'true' : undefined })}`, upsertBody(input))
  } catch (e) {
    if (e instanceof BackendError && e.code === 'partnerInactive') return { ok: false, error: 'partnerInactive' }
    throw e
  }
  // 다른 언어 번역은 응답을 보낸 뒤에 (번역 API가 느려도 저장은 바로 끝나게). 임시저장은 번역하지 않는다
  if (!draft) after(() => syncProductTranslations(created.id))
  // 검수는 심사 대상이 되는 상품만 — 임시저장은 아직 볼 이유가 없다
  if (!draft) after(() => inspectProductInBackground(created.id))
  return { ok: true, id: created.id }
}

type UpdateResult = { ok: true; id: string } | { ok: false; error: 'notFound' | 'partnerInactive' }

/**
 * 범위 밖이거나 없는 상품이면 notFound. 노출 상태는 그대로 둔다 — 단 submit이면 임시저장 상품을 심사중으로 넘긴다.
 * 업체는 바꾸지 않는다 — 예약은 업체를 상품으로만 찾아서, 바꾸면 지난 예약·정산(지급완료분 포함)이 새 업체로 넘어간다.
 * 수정 자체(소유 확인·partner-active 체크·저장·AuditLog)는 BE(PUT /api/v1/products/{id}?submit=)가 한다 —
 * notFound 판정은 BE가 범위 밖이면 404로 숨기는 것과 FE가 호출 전에 productBranchInfo로 거르는 것 둘 다로 겹쳐 막는다.
 */
export async function updateProduct(
  actorId: string,
  id: string,
  input: ProductInput,
  partnerIds: string[],
  { submit = false }: { submit?: boolean } = {},
): Promise<UpdateResult> {
  const found = await productBranchInfo(id, partnerIds)
  if (!found) return { ok: false, error: 'notFound' }
  try {
    await backend.put(`/api/v1/products/${id}${qs({ submit: submit ? 'true' : undefined })}`, upsertBody(input))
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'partnerInactive') return { ok: false, error: 'partnerInactive' }
    }
    throw e
  }
  const toReview = submit && found.status === 'draft'
  // 바뀐 칸만 다시 번역 (변경요청 승인으로 반영될 때도 여기를 지난다)
  after(() => syncProductTranslations(id))
  // 검수도 같이 다시 돌린다. 실패해도 저장은 이미 끝났다 (inspectProductInBackground가 삼킨다)
  if (found.status !== 'draft' || toReview) after(() => inspectProductInBackground(id))
  return { ok: true, id }
}

type StatusErrorCode = 'notFound' | 'approveCrosshubOnly' | 'partnerInactive' | 'commissionMissing' | 'translationMissing' | 'required'
type StatusResult = { ok: true } | { ok: false; error: StatusErrorCode }

/**
 * 심사중 상품은 크로스허브만 상태를 바꾼다(승인·반려). 노출중 ↔ 숨김은 상품을 다룰 수 있는 누구나.
 * 심사중 → 숨김 → 노출중으로 돌아서 승인을 건너뛰지 못하게, 심사중에서 나가는 것 자체를 승인으로 본다.
 * 전환 자체(권한·필수사유·partner-active·수수료율 체크·저장·AuditLog)는 BE(POST .../status)가 한다.
 * **번역 완료 체크(translationsComplete)만 FE가 BE 호출 전에 먼저 한다** — ProductTranslation은
 * 아직 BE에 없는 서브시스템이라 BE가 모른다. 담당자 알림 생성도 BE 응답 받은 뒤 FE가 이어서 한다.
 */
export async function setProductStatus(
  actor: { id: string; role: Role },
  id: string,
  status: ProductStatus,
  partnerIds: string[],
  reason?: string,
): Promise<StatusResult> {
  const found = await productBranchInfo(id, partnerIds)
  if (!found) return { ok: false, error: 'notFound' }
  if (found.status === status) return { ok: true }
  // 번역이 다 채워지기 전엔 노출하지 못한다 — TP 앱의 외국인 고객에게 원문(한국어 등)만 나가지 않게
  if (status === 'live' && !(await translationsComplete(id))) return { ok: false, error: 'translationMissing' }

  try {
    await backend.post(`/api/v1/products/${id}/status`, { status, reason })
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code) return { ok: false, error: e.code as StatusErrorCode }
    }
    throw e
  }

  if (found.status === 'review' && (status === 'live' || status === 'hidden')) {
    try {
      const recipientIds = await partnerStakeholders(found.partnerId, { includeCrosshub: false, includeAffiliate: true, includePartner: true })
      // sourceId에 상태를 같이 넣는다 — productId만 쓰면 이후 live→hidden 같은 다음 전환이 같은
      // (userId, type, sourceId) 조합이 되어 유니크 제약(skipDuplicates)에 걸려 조용히 버려진다.
      await createNotifications(recipientIds, { type: 'product_status_changed', productId: id, productName: found.name, status }, `${id}:${status}`)
    } catch (e) {
      console.error('[notifications] product_status_changed 알림 생성 실패', id, e)
    }
  }

  return { ok: true }
}

type DeleteResult = { ok: true } | { ok: false; error: 'notFound' | 'hasBookings' }

/** 문의가 달린 상품은 지우지 않는다 (숨김으로 바꾸게 한다). 삭제 자체(소유 확인·FK 위반 처리·AuditLog)는 BE가 한다. */
export async function deleteProduct(actorId: string, id: string, partnerIds: string[]): Promise<DeleteResult> {
  const found = await productBranchInfo(id, partnerIds)
  if (!found) return { ok: false, error: 'notFound' }
  try {
    await backend.delete(`/api/v1/products/${id}`)
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'hasBookings') return { ok: false, error: 'hasBookings' }
    }
    throw e
  }
}

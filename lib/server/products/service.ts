import 'server-only'
import { after } from 'next/server'
import { backend, BackendError, qs, seg } from '@/lib/api/backend'
import type { Role } from '@/lib/permissions'
import { PAGE_SIZE } from '@/lib/pagination'
import { saleRange } from '@/lib/products/schedule'
import { blocksFor, cancelRulesFor, priceTableFor, scheduleFor } from '@/lib/products/validate'
import { priceFrom, type ConfirmType, type ProductCategory, type ProductFull, type ProductInput, type ProductRow, type ProductStatus, type TranslationSummary } from '@/lib/products/types'
import type { ChangeRequestRow } from './change-requests'

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

/** BE(/api/v1/products) 요약 응답 모양. 번역 상태·최근 변경요청·보는 언어 상품명까지 BE 가 행마다 채워 준다. */
type BeProductSummary = {
  id: string
  partnerId: string
  partnerName: string | null
  status: string
  category: string
  confirmType: string
  name: string
  nameLocalized: string
  nameAi: boolean
  thumbnail: string | null
  priceFrom: number | null
  reviewRejectReason: string | null
  translation: TranslationSummary['state'] | null
  pendingChange: ChangeRequestRow | null
  createdAt: string
  updatedAt: string
}

/** 범위 안 상품 전체 (BE 가 토큰 기준으로 범위를 건다). keyword 는 상품명·업체명·어느 언어든 번역된 상품명 */
export async function fetchProducts(params: { status?: string; keyword?: string; locale?: string } = {}): Promise<BeProductSummary[]> {
  return backend.get<BeProductSummary[]>(`/api/v1/products${qs({ status: params.status, keyword: params.keyword?.trim() || undefined, locale: params.locale })}`)
}

/** 검색어에 맞는 상품 id (상품명·업체명·번역된 상품명) — 예약·문의 목록의 상품명 검색이 번역된 이름도 찾게 */
export async function productIdsMatching(keyword: string): Promise<Set<string>> {
  return new Set((await fetchProducts({ keyword })).map((r) => r.id))
}

/**
 * 목록. 업체 범위(partnerIds = 업체 전환·화면 필터)는 FE 가 한 번 더 좁힌다. 번역 상태·변경요청 칩 건수는 BE 행에서 바로 센다.
 * pendingChangeCount 는 상태 필터와 상관없이 (검색어·업체 조건만 적용한) 대기중 변경요청이 있는 상품 수.
 */
export async function listProducts(
  partnerIds: string[],
  params: ProductListParams,
): Promise<{ rows: ProductRow[]; total: number; pendingChangeCount: number }> {
  const beRows = (await fetchProducts({ keyword: params.keyword })).filter((r) => partnerIds.includes(r.partnerId))
  const pendingChangeCount = beRows.filter((r) => r.pendingChange?.status === 'pending').length

  let filtered = beRows
  if (params.pendingChange) filtered = filtered.filter((r) => r.pendingChange?.status === 'pending')
  if (params.status) filtered = filtered.filter((r) => r.status === params.status)
  filtered = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const total = filtered.length
  const pageRows = filtered.slice((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE)
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
    translation: r.translation ? { state: r.translation } : null,
  }))
  // 번역이 하나도 없는 상품(이 기능 전에 저장된 상품, 번역 실패)은 목록을 연 뒤에 BE 에 번역을 다시 걸어 둔다 — 새로고침하면 반영된다
  const untranslated = mapped.filter((r) => r.translation?.state === 'none').map((r) => r.id)
  if (untranslated.length) {
    after(async () => {
      for (const id of untranslated) {
        await backend.post(`/api/v1/products/${seg(id)}/translations/sync`).catch((e) => console.error('[translation] 번역 다시 걸기 실패', id, e))
      }
    })
  }
  return { pendingChangeCount, rows: mapped, total }
}

/** 크로스허브 대시보드용: 등록심사 상품, 오래 기다린 순 상위 N건 + 전체 건수 */
export async function listReviewProducts(partnerIds: string[], limit = 5) {
  const rows = (await fetchProducts({ status: 'review' }))
    .filter((r) => partnerIds.includes(r.partnerId))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return {
    rows: rows.slice(0, limit).map((r) => ({ id: r.id, name: r.name, nameAi: false, partnerName: r.partnerName ?? '', createdAt: r.createdAt })),
    total: rows.length,
  }
}

export type ReviewProductRow = Awaited<ReturnType<typeof listReviewProducts>>['rows'][number]

/** 예약·문의 화면의 "상품" 필터 드롭다운용 — 이름·소속 업체만 가볍게 */
export async function listProductOptions(partnerIds: string[]): Promise<{ id: string; name: string; partnerId: string }[]> {
  return (await fetchProducts())
    .filter((r) => partnerIds.includes(r.partnerId))
    .map((r) => ({ id: r.id, name: r.name, partnerId: r.partnerId }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 변경요청으로 보낼지 바로 반영할지 actions.ts가 판단하는 데 필요한 최소 정보 */
export async function productBranchInfo(id: string, partnerIds: string[]): Promise<{ id: string; status: ProductStatus; partnerId: string; name: string } | null> {
  const p = await getProduct(id, partnerIds)
  return p ? { id: p.id, status: p.status, partnerId: p.partnerId, name: p.name } : null
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
    p = await backend.get<BeProductDetail>(`/api/v1/products/${seg(id)}`)
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

export type DateCapacity = { open: boolean; max: number | null }

/** 빠른 보기 모달의 날짜별 판매 여부·정원 캘린더용 — 그 달 날짜마다 {open, max}. 계산은 BE (판매 일정) */
export async function getProductCapacity(id: string, partnerIds: string[], month: string): Promise<Record<string, DateCapacity> | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const p = await productBranchInfo(id, partnerIds)
  if (!p) return null
  try {
    return await backend.get<Record<string, DateCapacity>>(`/api/v1/products/${seg(id)}/capacity${qs({ month })}`)
  } catch (e) {
    if (e instanceof BackendError && (e.status === 404 || e.status === 400)) return null
    throw e
  }
}

// 새 상품은 항상 심사중으로 시작한다 (크로스허브가 승인해야 노출). 비활성 업체 체크·수수료율 체크는
// 이제 BE(ProductService.create/update/setStatus)가 한다 — isPartnerActive/hasCommissionRate는 더 안 씀.

type CreateResult = { ok: true; id: string } | { ok: false; error: 'partnerInactive' }

/**
 * draft면 임시저장(심사 요청 전), 아니면 바로 심사중. 등록 자체(partner-active 체크·저장·AuditLog)와
 * 저장 뒤 번역 자동생성·AI 검수(백그라운드)까지 BE(POST /api/v1/products?draft=)가 한다.
 */
export async function createProduct(actorId: string, input: ProductInput, { draft = false }: { draft?: boolean } = {}): Promise<CreateResult> {
  let created: { id: string }
  try {
    created = await backend.post<{ id: string }>(`/api/v1/products${qs({ draft: draft ? 'true' : undefined })}`, upsertBody(input))
  } catch (e) {
    if (e instanceof BackendError && e.code === 'partnerInactive') return { ok: false, error: 'partnerInactive' }
    throw e
  }
  return { ok: true, id: created.id }
}

type UpdateResult = { ok: true; id: string } | { ok: false; error: 'notFound' | 'partnerInactive' | 'forbidden' }

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
    await backend.put(`/api/v1/products/${seg(id)}${qs({ submit: submit ? 'true' : undefined })}`, upsertBody(input))
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'partnerInactive') return { ok: false, error: 'partnerInactive' }
      // 노출중·숨김 상품은 업체가 바로 못 고친다(BE가 막음) — 정상 화면 흐름에선 변경요청으로 가서 안 온다
      if (e.status === 403) return { ok: false, error: 'forbidden' }
    }
    throw e
  }
  // 바뀐 칸 다시 번역·검수는 BE 가 저장 뒤 백그라운드로 돌린다
  return { ok: true, id }
}

type StatusErrorCode = 'notFound' | 'approveCrosshubOnly' | 'partnerInactive' | 'commissionMissing' | 'translationMissing' | 'required' | 'forbidden'
type StatusResult = { ok: true } | { ok: false; error: StatusErrorCode }

/**
 * 심사중 상품은 크로스허브만 상태를 바꾼다(승인·반려). 노출중 ↔ 숨김은 상품을 다룰 수 있는 누구나.
 * 심사중 → 숨김 → 노출중으로 돌아서 승인을 건너뛰지 못하게, 심사중에서 나가는 것 자체를 승인으로 본다.
 * 전환 자체(권한·필수사유·partner-active·수수료율·번역 완료 체크·저장·AuditLog)와 담당자 알림, 크로스허브 직접 처리 때
 * 대기중 변경요청 자동 반려까지 전부 BE(POST .../status)가 한다.
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

  try {
    await backend.post(`/api/v1/products/${seg(id)}/status`, { status, reason })
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code) return { ok: false, error: e.code as StatusErrorCode }
    }
    throw e
  }
  return { ok: true }
}

type DeleteResult = { ok: true } | { ok: false; error: 'notFound' | 'hasBookings' | 'forbidden' }

/** 문의가 달린 상품은 지우지 않는다 (숨김으로 바꾸게 한다). 삭제 자체(소유 확인·FK 위반 처리·AuditLog·알림)는 BE가 한다. */
export async function deleteProduct(actorId: string, id: string, partnerIds: string[]): Promise<DeleteResult> {
  const found = await productBranchInfo(id, partnerIds)
  if (!found) return { ok: false, error: 'notFound' }
  try {
    await backend.delete(`/api/v1/products/${seg(id)}`)
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'hasBookings') return { ok: false, error: 'hasBookings' }
      if (e.status === 403) return { ok: false, error: 'forbidden' }
    }
    throw e
  }
}

import 'server-only'
import { prisma } from '@/lib/db'
import { backend, BackendError, seg } from '@/lib/api/backend'
import type { ProductInput, ProductStatus } from '@/lib/products/types'
import type { SessionUser } from '@/lib/server/auth/session'
import { productBranchInfo } from './service'

// 이미 심사(최초 등록 승인)를 통과한(live/hidden) 상품을 연맹·업체가 수정/삭제/숨김전환하면 즉시 반영하지
// 않고 "요청"만 만든다. 생성·승인(반영까지)·반려와 그때 가는 알림은 전부 BE(/api/v1/change-requests)가 한다.
// 조회(목록 뱃지·상세 배너·대시보드)는 아직 prisma — 조회를 옮기는 다음 단계에서 같이 간다.

export type ChangeType = 'edit' | 'delete' | 'hide'

export type ChangeRequestRow = {
  id: string
  type: ChangeType
  targetStatus: ProductStatus | null
  requestedByName: string
  rejectReason: string | null
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

type RawRequest = {
  id: string
  productId: string
  type: ChangeType
  targetStatus: ProductStatus | null
  status: 'pending' | 'approved' | 'rejected'
  rejectReason: string | null
  createdAt: Date
  requestedBy: { name: string }
}

function toRow(r: RawRequest): ChangeRequestRow {
  return {
    id: r.id,
    type: r.type,
    targetStatus: r.targetStatus,
    requestedByName: r.requestedBy.name,
    rejectReason: r.rejectReason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }
}

/** 상품 목록 화면용 벌크 조회. 상품마다 가장 최근 요청 1건(대기중 또는 반려됨)만 — 승인된 요청은
 *  이미 반영이 끝나 더 보여줄 게 없으므로 뺀다. */
export async function latestChangeRequestsByProduct(productIds: string[]): Promise<Record<string, ChangeRequestRow>> {
  if (productIds.length === 0) return {}
  const rows = await prisma.productChangeRequest.findMany({
    where: { productId: { in: productIds }, status: { in: ['pending', 'rejected'] } },
    orderBy: { createdAt: 'desc' },
    include: { requestedBy: { select: { name: true } } },
  })
  const result: Record<string, ChangeRequestRow> = {}
  for (const r of rows) {
    if (!result[r.productId]) result[r.productId] = toRow(r)
  }
  return result
}

/** 상품 상세(수정 화면) 배너용 단건 조회 */
export async function latestChangeRequestFor(productId: string): Promise<ChangeRequestRow | null> {
  const r = await prisma.productChangeRequest.findFirst({
    where: { productId, status: { in: ['pending', 'rejected'] } },
    orderBy: { createdAt: 'desc' },
    include: { requestedBy: { select: { name: true } } },
  })
  return r ? toRow(r) : null
}

export type ChangeRequestWithProposal = ChangeRequestRow & { proposedData: ProductInput | null }

/** 빠른 보기 모달용 — 수정(edit) 요청이면 "지금 값 → 바뀔 값" 비교를 보여줘야 해서 proposedData까지 포함.
 *  목록 화면의 뱃지(latestChangeRequestsByProduct)는 매 행마다 큰 JSON을 안 실어야 해서 이 함수와 분리해 둔다. */
export async function latestChangeRequestWithProposalFor(productId: string): Promise<ChangeRequestWithProposal | null> {
  const r = await prisma.productChangeRequest.findFirst({
    where: { productId, status: { in: ['pending', 'rejected'] } },
    orderBy: { createdAt: 'desc' },
    include: { requestedBy: { select: { name: true } } },
  })
  if (!r) return null
  return { ...toRow(r), proposedData: r.type === 'edit' ? (r.proposedData as unknown as ProductInput) : null }
}

/** 대시보드용: 크로스허브가 승인·반려해야 할 전체 대기중 변경요청 건수 (범위 전체 — 크로스허브 전용) */
/** 크로스허브 대시보드용: 대기중인 변경요청, 오래 기다린 순 상위 N건 + 전체 건수 */
export async function listPendingChangeRequests(partnerIds: string[], limit = 5) {
  const where = { status: 'pending' as const, product: { partnerId: { in: partnerIds } } }
  const [rows, total] = await Promise.all([
    prisma.productChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: { id: true, productId: true, type: true, targetStatus: true, createdAt: true, product: { select: { name: true, partner: { select: { name: true } } } } },
      take: limit,
    }),
    prisma.productChangeRequest.count({ where }),
  ])
  return {
    rows: rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      productNameAi: false,
      partnerName: r.product.partner.name,
      type: r.type as ChangeType,
      targetStatus: r.targetStatus,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
  }
}

export type PendingChangeRequestRow = Awaited<ReturnType<typeof listPendingChangeRequests>>['rows'][number]


export type CreateResult = { ok: true; id: string } | { ok: false; error: 'notFound' | 'duplicatePending' }

/** live/hidden 상품에 대한 요청 생성. review 상품은 호출하는 쪽(actions.ts)이 걸러서 여기로 안 보낸다.
 *  저장(범위·상태 확인, 대기중 중복 막기)과 크로스허브 알림은 BE가 한다 */
export async function createChangeRequest(
  input: { productId: string; type: ChangeType; targetStatus?: ProductStatus; proposedData?: ProductInput },
  _user: SessionUser,
  partnerIds: string[],
): Promise<CreateResult> {
  const product = await productBranchInfo(input.productId, partnerIds)
  if (!product) return { ok: false, error: 'notFound' }
  try {
    const request = await backend.post<{ id: string }>(`/api/v1/products/${seg(input.productId)}/change-requests`, {
      type: input.type,
      targetStatus: input.targetStatus ?? null,
      proposedData: input.proposedData ?? null,
    })
    return { ok: true, id: request.id }
  } catch (e) {
    if (e instanceof BackendError) return { ok: false, error: e.code === 'duplicatePending' ? 'duplicatePending' : 'notFound' }
    throw e
  }
}

type ResolveResult = { ok: true } | { ok: false; error: 'notFound' | 'hasBookings' | 'partnerInactive' | 'commissionMissing' | 'translationMissing' }

const RESOLVE_ERRORS = ['hasBookings', 'partnerInactive', 'commissionMissing', 'translationMissing'] as const

/**
 * 승인 — BE가 승인 표시와 실제 반영(수정·삭제·상태 전환)을 한 트랜잭션에서 하고 소유측에 알림을 보낸다.
 * 반영이 실패하면(예약 있음·업체 비활성·수수료율 없음·번역 미완) BE가 {code}로 알려주고 요청은 대기중 그대로 남는다.
 * 이미 누가 처리했으면 notFound.
 */
export async function approveChangeRequest(requestId: string, _resolver: SessionUser): Promise<ResolveResult> {
  try {
    await backend.post(`/api/v1/change-requests/${seg(requestId)}/approve`, {})
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.code && (RESOLVE_ERRORS as readonly string[]).includes(e.code)) return { ok: false, error: e.code as (typeof RESOLVE_ERRORS)[number] }
      if (e.status === 404 || e.status === 403 || e.status === 400) return { ok: false, error: 'notFound' }
    }
    throw e
  }
}

/** 반려 — Product는 전혀 건드리지 않고 요청 행만 rejected로 바꾼다. 소유측 알림은 BE가 보낸다 */
export async function rejectChangeRequest(requestId: string, _resolver: SessionUser, reason: string): Promise<ResolveResult> {
  try {
    await backend.post(`/api/v1/change-requests/${seg(requestId)}/reject`, { reason })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError && (e.status === 404 || e.status === 403 || e.status === 400)) return { ok: false, error: 'notFound' }
    throw e
  }
}

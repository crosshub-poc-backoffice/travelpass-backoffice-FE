import 'server-only'
import { backend, BackendError, qs, seg } from '@/lib/api/backend'
import type { ProductInput, ProductStatus } from '@/lib/products/types'
import type { SessionUser } from '@/lib/server/auth/session'
import { productBranchInfo } from './service'

// 이미 심사(최초 등록 승인)를 통과한(live/hidden) 상품을 연맹·업체가 수정/삭제/숨김전환하면 즉시 반영하지
// 않고 "요청"만 만든다. 생성·승인(반영까지)·반려와 그때 가는 알림은 전부 BE(/api/v1/change-requests)가 한다.
// 조회(목록 뱃지·상세 배너·빠른 보기·대시보드)도 BE 에서 받는다.

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

/** BE 최근 요청 한 줄 (proposedData 는 proposed=true 로 부를 때 edit 요청만) */
type BeChangeRequestRow = ChangeRequestRow & { productId: string; proposedData: ProductInput | null }

async function fetchLatest(productIds: string[], proposed: boolean): Promise<Record<string, BeChangeRequestRow>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return {}
  const out: Record<string, BeChangeRequestRow> = {}
  for (let i = 0; i < ids.length; i += 200) {
    Object.assign(out, await backend.get<Record<string, BeChangeRequestRow>>(
      `/api/v1/products/change-requests/latest${qs({ ids: ids.slice(i, i + 200).join(','), proposed: proposed ? 'true' : undefined })}`,
    ))
  }
  return out
}

function toRow(r: BeChangeRequestRow): ChangeRequestRow {
  return {
    id: r.id,
    type: r.type,
    targetStatus: r.targetStatus,
    requestedByName: r.requestedByName,
    rejectReason: r.rejectReason,
    status: r.status,
    createdAt: r.createdAt,
  }
}

/** 상품 목록 화면용 벌크 조회. 상품마다 가장 최근 요청 1건(대기중 또는 반려됨)만 — 승인된 요청은
 *  이미 반영이 끝나 더 보여줄 게 없으므로 뺀다. */
export async function latestChangeRequestsByProduct(productIds: string[]): Promise<Record<string, ChangeRequestRow>> {
  const rows = await fetchLatest(productIds, false)
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, toRow(r)]))
}

/** 상품 상세(수정 화면) 배너용 단건 조회 */
export async function latestChangeRequestFor(productId: string): Promise<ChangeRequestRow | null> {
  const r = (await fetchLatest([productId], false))[productId]
  return r ? toRow(r) : null
}

export type ChangeRequestWithProposal = ChangeRequestRow & { proposedData: ProductInput | null }

/** 빠른 보기 모달용 — 수정(edit) 요청이면 "지금 값 → 바뀔 값" 비교를 보여줘야 해서 proposedData까지 포함.
 *  목록 화면의 뱃지(latestChangeRequestsByProduct)는 매 행마다 큰 JSON을 안 실어야 해서 이 함수와 분리해 둔다. */
export async function latestChangeRequestWithProposalFor(productId: string): Promise<ChangeRequestWithProposal | null> {
  const r = (await fetchLatest([productId], true))[productId]
  if (!r) return null
  return { ...toRow(r), proposedData: r.type === 'edit' ? r.proposedData : null }
}

type BePendingPage = {
  rows: { id: string; productId: string; productName: string | null; partnerName: string | null; type: ChangeType; targetStatus: ProductStatus | null; createdAt: string }[]
  total: number
}

/** 크로스허브 대시보드용: 대기중인 변경요청, 오래 기다린 순 상위 N건 + 전체 건수. 업체 전환으로 고른 업체가 있으면 그 업체만 */
export async function listPendingChangeRequests(user: SessionUser, limit = 5) {
  const res = await backend.get<BePendingPage>(`/api/v1/change-requests${qs({ limit, partnerId: user.activePartnerId ?? undefined })}`)
  return {
    rows: res.rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName ?? '',
      productNameAi: false,
      partnerName: r.partnerName ?? '',
      type: r.type,
      targetStatus: r.targetStatus,
      createdAt: r.createdAt,
    })),
    total: res.total,
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

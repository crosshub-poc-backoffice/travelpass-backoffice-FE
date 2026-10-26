import 'server-only'
import { prisma } from '@/lib/db'
import { backend, BackendError, seg } from '@/lib/api/backend'
import { AUTO_REJECT_REASON, type ProductInput, type ProductStatus } from '@/lib/products/types'
import type { SessionUser } from '@/lib/server/auth/session'
import { crosshubUserIds, partnerStakeholders } from '@/lib/server/notifications/recipients'
import { createNotifications } from '@/lib/server/notifications/service'
import { deleteProduct, productBranchInfo, setProductStatus, updateProduct } from './service'

// 이미 심사(최초 등록 승인)를 통과한(live/hidden) 상품을 연맹·업체가 수정/삭제/숨김전환하면 즉시 반영하지
// 않고 "요청"만 만든다. 크로스허브가 승인해야 기존 updateProduct/deleteProduct/setProductStatus가
// 그제서야 호출된다 — 이 파일은 그 세 함수를 감싸는 승인 레이어일 뿐, 실제 반영 로직은 service.ts 그대로 쓴다.

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

/** live/hidden 상품에 대한 요청 생성. review 상품은 호출하는 쪽(actions.ts)이 걸러서 여기로 안 보낸다 */
export async function createChangeRequest(
  input: { productId: string; type: ChangeType; targetStatus?: ProductStatus; proposedData?: ProductInput },
  user: SessionUser,
  partnerIds: string[],
): Promise<CreateResult> {
  const product = await productBranchInfo(input.productId, partnerIds)
  if (!product) return { ok: false, error: 'notFound' }

  // 저장(범위·상태 확인, 대기중 중복 막기)은 BE가 한다. 알림은 FE가 이어서
  let request: { id: string }
  try {
    request = await backend.post<{ id: string }>(`/api/v1/products/${seg(input.productId)}/change-requests`, {
      type: input.type,
      targetStatus: input.targetStatus ?? null,
      proposedData: input.proposedData ?? null,
    })
  } catch (e) {
    if (e instanceof BackendError) return { ok: false, error: e.code === 'duplicatePending' ? 'duplicatePending' : 'notFound' }
    throw e
  }

  try {
    const recipientIds = await crosshubUserIds()
    await createNotifications(
      recipientIds,
      {
        type: 'product_change_requested',
        requestId: request.id,
        productId: input.productId,
        productName: product.name,
        changeType: input.type,
        targetStatus: asLiveOrHidden(input.targetStatus),
        requesterName: user.name,
      },
      request.id,
    )
  } catch (e) {
    console.error('[notifications] product_change_requested 알림 생성 실패', request.id, e)
  }

  return { ok: true, id: request.id }
}

type ResolveResult = { ok: true } | { ok: false; error: 'notFound' | 'hasBookings' | 'partnerInactive' | 'commissionMissing' | 'translationMissing' }


function asLiveOrHidden(status: ProductStatus | null | undefined): 'live' | 'hidden' | undefined {
  return status === 'live' || status === 'hidden' ? status : undefined
}

async function notifyResolved(
  request: { id: string; type: ChangeType; targetStatus: ProductStatus | null },
  product: { id: string; name: string; partnerId: string },
  outcome: 'approved' | 'rejected',
  reason?: string,
) {
  try {
    const recipientIds = await partnerStakeholders(product.partnerId, { includeCrosshub: false, includeAffiliate: true, includePartner: true })
    await createNotifications(
      recipientIds,
      {
        type: 'product_change_resolved',
        requestId: request.id,
        productId: product.id,
        productName: product.name,
        changeType: request.type,
        targetStatus: asLiveOrHidden(request.targetStatus),
        result: outcome,
        reason: outcome === 'rejected' ? reason : undefined,
      },
      `${request.id}:${outcome}`,
    )
  } catch (e) {
    console.error('[notifications] product_change_resolved 알림 생성 실패', request.id, e)
  }
}

type BeChangeRequest = {
  id: string
  productId: string
  productName: string | null
  partnerId: string | null
  type: ChangeType
  targetStatus: ProductStatus | null
  status: 'pending' | 'approved' | 'rejected'
  proposedData: ProductInput | null
}

/** BE 요청 조회. 없거나 권한 밖이면 null */
async function fetchRequest(requestId: string): Promise<BeChangeRequest | null> {
  try {
    return await backend.get<BeChangeRequest>(`/api/v1/change-requests/${seg(requestId)}`)
  } catch (e) {
    if (e instanceof BackendError && (e.status === 404 || e.status === 403)) return null
    throw e
  }
}

/**
 * 승인 — BE에 먼저 승인을 표시해 "내가 처리한다"를 선점한 뒤(대기중일 때만 성공 — 동시 승인·승인/반려 경합 방지),
 * type별로 기존 updateProduct/deleteProduct/setProductStatus(전부 BE 호출)로 반영한다.
 * 반영이 실패하면 BE reopen으로 대기중으로 되돌린다. 삭제 요청은 상품이 지워지며 요청 행도 cascade로 사라진다.
 */
export async function approveChangeRequest(requestId: string, resolver: SessionUser): Promise<ResolveResult> {
  const request = await fetchRequest(requestId)
  if (!request || request.status !== 'pending' || !request.partnerId) return { ok: false, error: 'notFound' }
  const product = { id: request.productId, name: request.productName ?? '', partnerId: request.partnerId }

  // 1) 선점: 이미 누가 승인·반려했으면 여기서 notFound
  try {
    await backend.post(`/api/v1/change-requests/${seg(requestId)}/approve`, {})
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return { ok: false, error: 'notFound' }
    throw e
  }

  // 2) 반영. 실패하면 선점을 풀어 다시 처리할 수 있게 한다
  const reopen = () => backend.post(`/api/v1/change-requests/${seg(requestId)}/reopen`, {}).catch((err) => {
    console.error('[change-request] 승인 되돌리기 실패 — 요청이 승인됨으로 남음', requestId, err)
  })
  let applied: { ok: true } | { ok: false; error: string }
  try {
    applied =
      request.type === 'delete'
        ? await deleteProduct(resolver.id, request.productId, [product.partnerId])
        : request.type === 'edit'
          ? await updateProduct(resolver.id, request.productId, request.proposedData as ProductInput, [product.partnerId])
          : await setProductStatus(resolver, request.productId, request.targetStatus as ProductStatus, [product.partnerId])
  } catch (e) {
    await reopen()
    throw e
  }
  if (!applied.ok) {
    await reopen()
    const err = applied.error
    if (request.type !== 'hide') return { ok: false, error: err as Extract<ResolveResult, { ok: false }>['error'] }
    return { ok: false, error: err === 'partnerInactive' || err === 'commissionMissing' || err === 'translationMissing' ? err : 'notFound' }
  }

  await notifyResolved(request, product, 'approved')
  return { ok: true }
}

/** 반려 — Product는 전혀 건드리지 않고 요청 행만 rejected로 바꾼다. 수동 반려·자동 반려(엣지케이스) 공용 */
export async function rejectChangeRequest(requestId: string, _resolver: SessionUser, reason: string): Promise<ResolveResult> {
  let request: BeChangeRequest
  try {
    request = await backend.post<BeChangeRequest>(`/api/v1/change-requests/${seg(requestId)}/reject`, { reason })
  } catch (e) {
    if (e instanceof BackendError && (e.status === 404 || e.status === 403 || e.status === 400)) return { ok: false, error: 'notFound' }
    throw e
  }
  if (request.partnerId) {
    await notifyResolved(request, { id: request.productId, name: request.productName ?? '', partnerId: request.partnerId }, 'rejected', reason)
  }
  return { ok: true }
}

/** 크로스허브가 직접 수정/삭제/숨김전환을 끝낸 뒤 호출 — 소유측(업체+대행연맹)에게 알림만 보낸다 */
export async function notifyDirectChange(product: { id: string; name: string; partnerId: string }, changeType: ChangeType, targetStatus?: ProductStatus): Promise<void> {
  try {
    const recipientIds = await partnerStakeholders(product.partnerId, { includeCrosshub: false, includeAffiliate: true, includePartner: true })
    await createNotifications(
      recipientIds,
      { type: 'product_direct_change', productId: product.id, productName: product.name, changeType, targetStatus: asLiveOrHidden(targetStatus) },
      `${product.id}:${changeType}:${Date.now()}`,
    )
  } catch (e) {
    console.error('[notifications] product_direct_change 알림 생성 실패', product.id, e)
  }
}

/** 크로스허브가 직접 수정/삭제/숨김전환하기 직전에 호출한다. 그 상품에 열려있는 요청이 있으면
 *  자동으로 반려 처리해 "요청과 직접처리가 동시에 떠 있는" 상태를 막는다. 없으면 아무 일도 안 한다 */
export async function supersedePendingRequest(productId: string, resolver: SessionUser): Promise<void> {
  const pending = await prisma.productChangeRequest.findFirst({ where: { productId, status: 'pending' }, select: { id: true } })
  if (!pending) return
  await rejectChangeRequest(pending.id, resolver, AUTO_REJECT_REASON)
}

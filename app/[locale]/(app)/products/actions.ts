'use server'

import { refresh } from 'next/cache'
import { getLocale } from 'next-intl/server'
import type { ErrorKey } from '@/lib/errors'
import { canApproveChangeRequest, canCreateProduct } from '@/lib/permissions'
import { PRODUCT_STATUSES, type ProductFull, type ProductStatus } from '@/lib/products/types'
import { parseProductInput } from '@/lib/products/validate'
import type { DateCapacity } from '@/lib/server/bookings/service'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import {
  approveChangeRequest,
  createChangeRequest,
  latestChangeRequestWithProposalFor,
  notifyDirectChange,
  rejectChangeRequest,
  supersedePendingRequest,
  type ChangeRequestWithProposal,
} from '@/lib/server/products/change-requests'
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProductCapacity,
  partnerForWrite,
  productBranchInfo,
  setProductStatus,
  updateProduct,
} from '@/lib/server/products/service'
import { changeSourceLocale, localizeProductFor, retranslate, saveTranslation } from '@/lib/server/products/translations'

export type SaveResult = { error?: ErrorKey; id?: string; pendingRequest?: true }

/** 등록(id 없음) 또는 수정. 업체 계정은 자기 업체로 고정, 연맹·크로스허브는 다룰 수 있는 업체만.
 *  등록(id 없음)은 연맹·업체만 — 크로스허브는 수정만 한다.
 *  asDraft: 임시저장 — 새 상품이거나 아직 임시저장인 상품만. 임시저장 상품을 asDraft 없이 저장하면 심사중으로 넘어간다(등록).
 *  심사를 통과한(live/hidden) 상품을 연맹·업체가 수정하면 즉시 반영 대신 "요청"만 만든다 — 크로스허브는 즉시 반영 */
export async function saveProduct(raw: unknown, id?: string, asDraft = false): Promise<SaveResult> {
  const user = await requireMenu('products', 'edit', id ? 'update' : 'create')
  if (!id && !canCreateProduct(user.role)) return { error: 'forbidden' }
  const scope = visiblePartnerIds(user)

  const parsed = parseProductInput(raw, { draft: asDraft })
  if (!parsed.ok) return { error: parsed.error }
  const partnerId = partnerForWrite(user, scope, parsed.value.partnerId)
  if (!partnerId) return { error: 'invalidOrg' }
  const input = { ...parsed.value, partnerId }

  if (!id) {
    const created = await createProduct(user.id, input, { draft: asDraft })
    if (!created.ok) return { error: created.error }
    refresh()
    return { id: created.id }
  }

  const branch = await productBranchInfo(id, scope)
  if (!branch) return { error: 'notFound' }
  if (asDraft && branch.status !== 'draft') return { error: 'notFound' }

  // 임시저장·심사중은 요청 구조 없이 바로 고친다
  if (branch.status === 'draft' || branch.status === 'review' || user.role === 'crosshub') {
    if (user.role === 'crosshub' && branch.status !== 'review' && branch.status !== 'draft') await supersedePendingRequest(id, user)
    const updated = await updateProduct(user.id, id, input, [branch.partnerId], { submit: !asDraft })
    if (!updated.ok) return { error: updated.error }
    if (user.role === 'crosshub' && branch.status !== 'review' && branch.status !== 'draft') await notifyDirectChange(branch, 'edit')
    refresh()
    return { id: updated.id }
  }

  const created = await createChangeRequest({ productId: id, type: 'edit', proposedData: input }, user, scope)
  if (!created.ok) return { error: created.error === 'duplicatePending' ? 'changeRequestDuplicate' : 'notFound' }
  refresh()
  return { pendingRequest: true }
}

export async function changeProductStatus(id: string, status: ProductStatus, reason?: string): Promise<SaveResult> {
  const user = await requireMenu('products', 'edit')
  if (typeof id !== 'string' || !PRODUCT_STATUSES.includes(status)) return { error: 'notFound' }
  const scope = visiblePartnerIds(user)
  const branch = await productBranchInfo(id, scope)
  if (!branch) return { error: 'notFound' }
  if (branch.status === 'review' && status === 'hidden' && !reason?.trim()) return { error: 'required' }

  // 심사중(review) 전환은 지금처럼 setProductStatus가 크로스허브 전용 가드를 직접 갖고 있다 — 그대로 둔다
  if (branch.status === 'review' || user.role === 'crosshub') {
    if (user.role === 'crosshub' && branch.status !== 'review') await supersedePendingRequest(id, user)
    const result = await setProductStatus(user, id, status, [branch.partnerId], reason?.trim())
    if (!result.ok) return { error: result.error }
    if (user.role === 'crosshub' && branch.status !== 'review') await notifyDirectChange(branch, 'hide', status)
    refresh()
    return {}
  }

  const created = await createChangeRequest({ productId: id, type: 'hide', targetStatus: status }, user, scope)
  if (!created.ok) return { error: created.error === 'duplicatePending' ? 'changeRequestDuplicate' : 'notFound' }
  refresh()
  return { pendingRequest: true }
}

export async function removeProduct(id: string): Promise<SaveResult> {
  const user = await requireMenu('products', 'edit', 'delete')
  if (typeof id !== 'string') return { error: 'notFound' }
  const scope = visiblePartnerIds(user)
  const branch = await productBranchInfo(id, scope)
  if (!branch) return { error: 'notFound' }

  if (branch.status === 'draft' || branch.status === 'review' || user.role === 'crosshub') {
    if (user.role === 'crosshub' && branch.status !== 'review' && branch.status !== 'draft') await supersedePendingRequest(id, user)
    const result = await deleteProduct(user.id, id, [branch.partnerId])
    if (!result.ok) return { error: result.error }
    if (user.role === 'crosshub' && branch.status !== 'review' && branch.status !== 'draft') await notifyDirectChange(branch, 'delete')
    refresh()
    return {}
  }

  const created = await createChangeRequest({ productId: id, type: 'delete' }, user, scope)
  if (!created.ok) return { error: created.error === 'duplicatePending' ? 'changeRequestDuplicate' : 'notFound' }
  refresh()
  return { pendingRequest: true }
}

export async function approveProductChange(requestId: string): Promise<{ error?: ErrorKey }> {
  const user = await requireMenu('products', 'edit')
  if (!canApproveChangeRequest(user.role)) return { error: 'forbidden' }
  const result = await approveChangeRequest(requestId, user)
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

export async function rejectProductChange(requestId: string, reason: string): Promise<{ error?: ErrorKey }> {
  const user = await requireMenu('products', 'edit')
  if (!canApproveChangeRequest(user.role)) return { error: 'forbidden' }
  if (!reason.trim()) return { error: 'required' }
  const result = await rejectChangeRequest(requestId, user, reason.trim())
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

/** product = 원문 (변경요청 비교용), display = 보는 사람 언어로 바꾼 사본 (화면 표시용) */
export type ProductQuickView = { product: ProductFull; display: ProductFull; nameAi: boolean; changeRequest: ChangeRequestWithProposal | null; month: string; capacity: Record<string, DateCapacity> }

/** 목록에서 상품명을 눌렀을 때 뜨는 빠른 보기 모달용. month 생략하면 이번 달.
 *  수정 요청이 걸려있으면 "지금 값 → 바뀔 값" 비교를 보여주려고 proposedData까지 같이 내려준다. */
export async function getProductQuickView(id: string, month?: string): Promise<ProductQuickView | { error: ErrorKey }> {
  const user = await requireMenu('products')
  const scope = visiblePartnerIds(user)
  const targetMonth = month ?? new Date().toISOString().slice(0, 7)

  const product = await getProduct(id, scope)
  if (!product) return { error: 'notFound' }

  const [changeRequest, capacity, localized] = await Promise.all([
    latestChangeRequestWithProposalFor(id),
    getProductCapacity(id, scope, targetMonth),
    localizeProductFor(product, await getLocale()),
  ])
  return { product, display: localized.product, nameAi: localized.nameAi, changeRequest, month: targetMonth, capacity: capacity ?? {} }
}

/** 빠른 보기 모달의 캘린더에서 이전/다음 달로 이동할 때 — 상품 정보는 다시 안 가져오고 그 달 정원만 */
export async function getProductCapacityMonth(id: string, month: string): Promise<Record<string, DateCapacity> | { error: ErrorKey }> {
  const user = await requireMenu('products')
  const scope = visiblePartnerIds(user)
  const capacity = await getProductCapacity(id, scope, month)
  if (!capacity) return { error: 'notFound' }
  return capacity
}

// ── 상품 번역 (번역 화면) ── 상품을 수정할 수 있는 사람이 번역도 고친다. 번역은 변경요청 없이 바로 반영

/** 그 언어의 모든 칸을 다시 번역 */
export async function retranslateProduct(id: string, locale: string): Promise<{ error?: ErrorKey }> {
  const user = await requireMenu('products', 'edit')
  const result = await retranslate(user.id, id, locale, visiblePartnerIds(user))
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

/** 고친 칸만 저장. review면 검수 완료로 */
export async function saveProductTranslation(id: string, locale: string, edits: Record<string, string>, review: boolean): Promise<{ error?: ErrorKey }> {
  const user = await requireMenu('products', 'edit')
  if (!edits || typeof edits !== 'object') return { error: 'notFound' }
  const result = await saveTranslation(user.id, id, locale, edits, review, visiblePartnerIds(user))
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

/** 자동 감지가 틀렸을 때 원문 언어를 바로잡는다 */
export async function setProductSourceLocale(id: string, locale: string): Promise<{ error?: ErrorKey }> {
  const user = await requireMenu('products', 'edit')
  const result = await changeSourceLocale(user.id, id, locale, visiblePartnerIds(user))
  if (!result.ok) return { error: result.error }
  refresh()
  return {}
}

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { MoreVertical, Package, Plus, Search, TriangleAlert } from 'lucide-react'
import { usePathname, useRouter, Link } from '@/i18n/navigation'
import { AiText } from '@/components/ai-tag'
import { Pagination } from '@/components/pagination'
import type { ErrorKey } from '@/lib/errors'
import { PAGE_SIZE } from '@/lib/pagination'
import { AUTO_REJECT_REASON, priceFrom, PRODUCT_STATUSES, type ProductFull, type ProductInput, type ProductRow, type ProductStatus } from '@/lib/products/types'
import type { ChangeRequestRow } from '@/lib/server/products/change-requests'
import {
  approveProductChange,
  changeProductStatus,
  getProductCapacityMonth,
  getProductQuickView,
  rejectProductChange,
  removeProduct,
  type ProductQuickView,
} from './actions'
import { CapacityCalendar } from './capacity-calendar'
import { formatYen } from './_form/fields'
import './_form/product-form.css'

// 행 ⋯ 메뉴의 대략 높이 (숨김·삭제 한 줄) — 아래 공간이 모자라 위로 띄울지 정할 때 쓴다
const MENU_HEIGHT_PX = 56

const STATUS_CLASS: Record<ProductStatus, string> = { draft: 'status-draft', live: 'status-live', review: 'status-review', hidden: 'status-hidden' }

// 빠른 보기 모달 섹션 제목 — 작은 회색 eyebrow보다 또렷하게, 구획을 한눈에 구분할 수 있게
const SECTION_LABEL_STYLE = {
  fontSize: 15,
  fontWeight: 700,
  color: '#41443f',
  margin: '0 0 12px',
  paddingBottom: 8,
  borderBottom: '2px solid #f0f0ed',
}

function changeLabel(tp: (key: string) => string, req: ChangeRequestRow): string {
  if (req.type === 'edit') return tp('changeRequest.labelEdit')
  if (req.type === 'delete') return tp('changeRequest.labelDelete')
  return tp(req.targetStatus === 'live' ? 'changeRequest.labelShow' : 'changeRequest.labelHide')
}

// 수정 요청 승인 전 "지금 값 → 바뀔 값" 비교에 보여줄 필드만 추린다 — 일정표·요금조정표 같은 큰 구조는
// 통째로 보여주기엔 너무 커서, 승인 판단에 실제로 중요한 핵심 필드만 비교한다
function buildProposalDiff(current: ProductFull, proposed: ProductInput, tp: (key: string, values?: Record<string, string | number>) => string) {
  const rows: { label: string; before: string; after: string }[] = []
  if (current.name !== proposed.name) rows.push({ label: tp('name'), before: current.name, after: proposed.name })
  if (current.description !== proposed.description) rows.push({ label: tp('description'), before: current.description || '—', after: proposed.description || '—' })
  const beforePrice = priceFrom(current.priceTable)
  const afterPrice = priceFrom(proposed.priceTable)
  if (beforePrice !== afterPrice) {
    rows.push({ label: tp('priceFrom'), before: beforePrice === null ? '—' : formatYen(beforePrice), after: afterPrice === null ? '—' : formatYen(afterPrice) })
  }
  if (current.confirmType !== proposed.confirmType) rows.push({ label: tp('confirmType'), before: tp(`confirm.${current.confirmType}`), after: tp(`confirm.${proposed.confirmType}`) })
  if (current.deadlineDays !== proposed.deadlineDays || current.deadlineTime !== proposed.deadlineTime) {
    rows.push({
      label: tp('quickView.deadline'),
      before: tp('quickView.deadlineText', { days: current.deadlineDays, time: current.deadlineTime }),
      after: tp('quickView.deadlineText', { days: proposed.deadlineDays, time: proposed.deadlineTime }),
    })
  }
  return rows
}

export function ProductsView({
  rows,
  total,
  page,
  keyword: initialKeyword,
  status: initialStatus,
  pendingChangeCount,
  canCreate,
  canEdit,
  canApprove,
  canApproveChangeRequest,
  changeRequests,
  initialHighlightId = null,
  partners,
  partnerId: initialPartnerId,
}: {
  rows: ProductRow[]
  total: number
  page: number
  keyword: string
  status: string
  pendingChangeCount: number
  canCreate: boolean
  canEdit: boolean
  canApprove: boolean
  canApproveChangeRequest: boolean
  changeRequests: Record<string, ChangeRequestRow>
  initialHighlightId?: string | null
  partners: { id: string; name: string }[]
  partnerId: string
}) {
  const t = useTranslations()
  const tp = useTranslations('products')
  const tt = useTranslations('productTranslation')
  const router = useRouter()
  const pathname = usePathname()
  const [keyword, setKeyword] = useState(initialKeyword)
  const [status, setStatus] = useState(initialStatus)
  const [partnerFilter, setPartnerFilter] = useState(initialPartnerId)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [pending, startTransition] = useTransition()
  const [highlightId, setHighlightId] = useState<string | null>(initialHighlightId)
  const [rejectTarget, setRejectTarget] = useState<{ id: string; kind: 'changeRequest' | 'review' } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [quickViewId, setQuickViewId] = useState<string | null>(null)
  const [quickView, setQuickView] = useState<ProductQuickView | { error: ErrorKey } | null>(null)
  const [monthLoading, setMonthLoading] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  // 자동 반려 사유는 DB에 한국어로 남아 있어서 화면 언어 문구로 바꿔 보여준다
  const rejectReasonText = (reason: string | null) => (reason === AUTO_REJECT_REASON ? tp('changeRequest.autoRejectReason') : reason)
  // 메뉴를 화면 기준(fixed)으로 띄울 위치 — 표 안(overflow)에 두면 마지막 행에서 표에 스크롤이 생긴다
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const keywordDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 행의 ⋯ 메뉴 — 바깥 클릭이나 Esc로 닫는다 (shell.tsx 드롭다운과 같은 패턴)
  useEffect(() => {
    if (!openMenuId) return
    function handlePointerDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-row-menu]')) setOpenMenuId(null)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenuId(null)
    }
    // fixed라 스크롤하면 버튼과 떨어진다 — 그냥 닫는다
    function close() {
      setOpenMenuId(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [openMenuId])

  function openQuickView(id: string) {
    setQuickViewId(id)
    setQuickView(null)
    getProductQuickView(id).then(setQuickView)
  }
  function closeQuickView() {
    setQuickViewId(null)
    setQuickView(null)
  }
  function changeQuickViewMonth(month: string) {
    if (!quickViewId || !quickView || !('product' in quickView)) return
    setMonthLoading(true)
    getProductCapacityMonth(quickViewId, month).then((result) => {
      setMonthLoading(false)
      if ('error' in result) return
      setQuickView((prev) => (prev && 'product' in prev ? { ...prev, month, capacity: result } : prev))
    })
  }

  // 알림 벨 클릭(?id=...)으로 들어오면 그 행으로 스크롤 + 잠깐 강조한다. 마운트 시 한 번만.
  useEffect(() => {
    if (!highlightId) return
    document.querySelector(`[data-product-row="${highlightId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlightId(null), 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
  }, [])

  // keyword·status·partnerId·page는 URL 쿼리로 들고 있다 — 검색·필터·페이지 이동마다 서버에서 다시 조회한다.
  function pushQuery(next: { keyword?: string; status?: string; partnerId?: string; page?: number }) {
    const merged = { keyword, status, partnerId: partnerFilter, page, ...next }
    const query: Record<string, string> = {}
    if (merged.keyword) query.keyword = merged.keyword
    if (merged.status && merged.status !== 'all') query.status = merged.status
    if (merged.partnerId && merged.partnerId !== 'all') query.partnerId = merged.partnerId
    if (merged.page && merged.page > 1) query.page = String(merged.page)
    router.replace({ pathname, query })
  }

  function handleKeywordChange(value: string) {
    setKeyword(value)
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
    keywordDebounce.current = setTimeout(() => pushQuery({ keyword: value, page: 1 }), 400)
  }

  function handleStatusChange(value: string) {
    setStatus(value)
    pushQuery({ status: value, page: 1 })
  }

  function handlePartnerChange(value: string) {
    setPartnerFilter(value)
    pushQuery({ partnerId: value, page: 1 })
  }

  const run = (fn: () => Promise<{ error?: ErrorKey }>) => {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (result.error) setError(result.error)
    })
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PRODUCTS</p>
          <h1>{t('page.products.title')}</h1>
        </div>
        {canCreate && (
          <Link href="/products/new" className="primary-button">
            <Plus size={18} /> {t('page.products.newTitle')}
          </Link>
        )}
      </section>

      <div className="card products-card">
        {/* 위 줄은 검색·업체, 아래 줄은 상태 칩 (예약·문의 화면과 같은 배치) */}
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div className="search-box">
            <Search size={17} />
            <input placeholder={tp('searchPlaceholder')} value={keyword} onChange={(e) => handleKeywordChange(e.target.value)} />
          </div>
          {partners.length > 1 && (
            <select className="toolbar-select" value={partnerFilter} onChange={(e) => handlePartnerChange(e.target.value)} aria-label={tp('partner')}>
              <option value="all">
                {tp('partner')}: {t('inquiries.statusAll')}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="filter-chips" role="group" aria-label={tp('statusTitle')}>
          {(['all', ...PRODUCT_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-chip${status === s ? ' is-active' : ''}`}
              aria-pressed={status === s}
              onClick={() => handleStatusChange(s)}
            >
              {s === 'all' ? t('inquiries.statusAll') : tp(`status.${s}`)}
            </button>
          ))}
          {/* 변경요청은 상품 상태가 아니라 노출중·숨김 상품에 붙은 요청이라 구분선 뒤에 따로 */}
          <span className="filter-chips-divider" />
          <button
            type="button"
            className={`filter-chip${status === 'changeRequest' ? ' is-active' : ''}`}
            aria-pressed={status === 'changeRequest'}
            onClick={() => handleStatusChange('changeRequest')}
          >
            {tp('changeRequestFilter')}
            <span className="filter-chip-count">{pendingChangeCount}</span>
          </button>
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{tp('name')}</th>
                <th>{tp('partner')}</th>
                <th>{tp('statusTitle')}</th>
                <th>
                  <span className="sr-only">{tp('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const showStatusToggle = p.status !== 'review' && p.status !== 'draft' && changeRequests[p.id]?.status !== 'pending'
                const showReviewApprove = p.status === 'review' && canApprove
                const showChangeRequestActions = changeRequests[p.id]?.status === 'pending' && canApproveChangeRequest
                // 심사중 상품도 변경요청 구조를 안 거치고 누구나 직접 삭제할 수 있다(removeProduct 액션) — 그러니 항상 보여준다.
                // 단, 대기중인 변경요청이 이미 "삭제" 요청이면 승인/반려 버튼이 그 역할을 대신하니 중복으로 또 띄우지 않는다
                const showDelete = !(changeRequests[p.id]?.status === 'pending' && changeRequests[p.id]?.type === 'delete')
                // 승인·반려는 크로스허브 주 업무라 행에 바로, 숨김·노출 전환과 삭제는 가끔 쓰니 점 3개 메뉴에
                const hasMenu = showStatusToggle || showDelete
                return (
                <tr key={p.id} data-product-row={p.id} style={p.id === highlightId ? { background: '#fff4ef', transition: 'background-color 0.6s' } : undefined}>
                  <td>
                    <button type="button" className="table-link product-cell" onClick={() => openQuickView(p.id)}>
                      <div className="product-thumb product-orange">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.image ? <img src={p.image} alt="" /> : <Package size={20} />}
                      </div>
                      <strong>
                        <AiText ai={p.nameAi}>{p.name}</AiText>
                      </strong>
                    </button>
                  </td>
                  <td>{p.partnerName}</td>
                  <td>
                    <span className={`status ${STATUS_CLASS[p.status]}`} title={p.status === 'hidden' && p.reviewRejectReason ? p.reviewRejectReason : undefined}>
                      <i />
                      {tp(`status.${p.status}`)}
                    </span>
                    {changeRequests[p.id] && (
                      <span
                        className={`status ${changeRequests[p.id].status === 'pending' ? 'status-review' : 'status-hidden'}`}
                        style={{ marginLeft: 6 }}
                        title={changeRequests[p.id].status === 'rejected' ? (rejectReasonText(changeRequests[p.id].rejectReason) ?? undefined) : undefined}
                      >
                        <i />
                        {tp(changeRequests[p.id].status === 'pending' ? 'changeRequest.badgePending' : 'changeRequest.badgeRejected', {
                          label: changeLabel(tp, changeRequests[p.id]),
                        })}
                      </span>
                    )}
                  </td>
                  <td>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                        {(showReviewApprove || showChangeRequestActions) && (
                          <>
                            <button
                              type="button"
                              className="outline-button approve"
                              disabled={pending}
                              onClick={() => run(() => (showReviewApprove ? changeProductStatus(p.id, 'live') : approveProductChange(changeRequests[p.id].id)))}
                            >
                              {tp('approve')}
                            </button>
                            <button
                              type="button"
                              className="outline-button danger"
                              disabled={pending}
                              onClick={() => {
                                setRejectReason('')
                                setRejectTarget(showReviewApprove ? { id: p.id, kind: 'review' } : { id: changeRequests[p.id].id, kind: 'changeRequest' })
                              }}
                            >
                              {tp('reject')}
                            </button>
                          </>
                        )}
                        {/* 번역 화면으로. 점 색 + 글자로 번역 상태를 같이 보여준다. 임시저장은 번역하지 않아서 없음 */}
                        {p.translation && (
                          <Link href={`/products/${p.id}/translations`} className="outline-button tr-cell-button">
                            <i className={`tr-dot tr-dot-${p.translation.state}`} />
                            {tt(`state.${p.translation.state}`)}
                          </Link>
                        )}
                        <Link href={`/products/${p.id}`} className="outline-button">
                          {tp('edit')}
                        </Link>
                        {hasMenu && (
                        <div data-row-menu style={{ position: 'relative' }}>
                          <button
                            type="button"
                            className="more-button"
                            aria-label={tp('actions')}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect()
                              // 아래 공간이 모자라면 버튼 위로 띄운다
                              const top = r.bottom + 6 + MENU_HEIGHT_PX > window.innerHeight ? r.top - 6 - MENU_HEIGHT_PX : r.bottom + 6
                              setMenuPos({ top, right: window.innerWidth - r.right })
                              setOpenMenuId(openMenuId === p.id ? null : p.id)
                            }}
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openMenuId === p.id && menuPos && (
                            <div
                              style={{
                                position: 'fixed',
                                top: menuPos.top,
                                right: menuPos.right,
                                display: 'flex',
                                alignItems: 'stretch',
                                width: 'max-content',
                                background: '#fff',
                                border: '1px solid var(--border)',
                                borderRadius: 10,
                                padding: 6,
                                zIndex: 40,
                                boxShadow: '0 12px 30px #00000014',
                              }}
                            >
                              {showStatusToggle && (
                                <button
                                  type="button"
                                  className="nav-item"
                                  style={{ width: 'auto', whiteSpace: 'nowrap' }}
                                  disabled={pending}
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    run(() => changeProductStatus(p.id, p.status === 'live' ? 'hidden' : 'live'))
                                  }}
                                >
                                  {p.status === 'live' ? tp('hide') : tp('show')}
                                </button>
                              )}
                              {showDelete && showStatusToggle && <div style={{ width: 1, alignSelf: 'stretch', background: '#f0f0ed', margin: '0 4px' }} />}
                              {showDelete && (
                                <button
                                  type="button"
                                  className="nav-item danger"
                                  style={{ width: 'auto', whiteSpace: 'nowrap' }}
                                  disabled={pending || (changeRequests[p.id]?.status === 'pending' && !canApproveChangeRequest)}
                                  onClick={() => {
                                    setOpenMenuId(null)
                                    if (window.confirm(tp('deleteConfirm'))) run(() => removeProduct(p.id))
                                  }}
                                >
                                  {tp('delete')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                    {total === 0 && !keyword && status === 'all' ? tp('empty') : tp('noMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(next) => pushQuery({ page: next })} />
      </div>

      {error && (
        <div className="modal-backdrop" role="presentation" onClick={() => setError(null)}>
          <div className="modal-card" style={{ width: 'min(400px,100%)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: '0 0 auto', width: 40, height: 40, borderRadius: '50%', background: '#fdf1ef', display: 'grid', placeItems: 'center' }}>
                <TriangleAlert size={20} color="#c45b4d" />
              </div>
              <p style={{ margin: '7px 0 0', fontSize: 14, lineHeight: 1.6, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{t(`errors.${error}`)}</p>
            </div>
            <div className="modal-actions" style={{ marginTop: 22 }}>
              <button className="primary-button" onClick={() => setError(null)}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <div className="modal-backdrop" role="presentation" onClick={() => setRejectTarget(null)}>
          <div className="modal-card" style={{ width: 'min(420px,100%)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <h2>{tp('changeRequest.rejectTitle')}</h2>
              <button className="close-button" onClick={() => setRejectTarget(null)}>
                ✕
              </button>
            </div>
            <label className="modal-label" style={{ marginTop: 16 }}>
              {tp('changeRequest.rejectTitle')}
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder={tp('changeRequest.rejectPlaceholder')} />
            </label>
            <div className="modal-actions">
              <button className="outline-button" onClick={() => setRejectTarget(null)}>
                {tp('changeRequest.cancel')}
              </button>
              <button
                className="outline-button danger"
                disabled={pending || !rejectReason.trim()}
                onClick={() => {
                  const target = rejectTarget
                  setRejectTarget(null)
                  run(() => (target.kind === 'review' ? changeProductStatus(target.id, 'hidden', rejectReason) : rejectProductChange(target.id, rejectReason)))
                }}
              >
                {tp('changeRequest.rejectSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {quickViewId && (
        <div className="modal-backdrop" role="presentation" onClick={closeQuickView}>
          {/* 넓게 써서 왼쪽(조건·요금·취소 수수료) / 오른쪽(날짜별 정원) 두 칸 — 세로·가로 스크롤 없이 한 화면에 */}
          <div className="modal-card quick-view" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <p className="eyebrow">{tp('quickView.title')}</p>
                <h2>{quickView && 'product' in quickView ? <AiText ai={quickView.nameAi}>{quickView.display.name}</AiText> : ' '}</h2>
                {quickView && 'product' in quickView && (
                  <p className="heading-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {quickView.product.partnerName}
                    <span className={`status ${STATUS_CLASS[quickView.product.status]}`}>
                      <i />
                      {tp(`status.${quickView.product.status}`)}
                    </span>
                  </p>
                )}
              </div>
              <button className="close-button" onClick={closeQuickView}>
                ✕
              </button>
            </div>

            {!quickView && <p className="muted">{t('common.processing')}</p>}
            {quickView && 'error' in quickView && <p style={{ color: '#c45b4d' }}>{t(`errors.${quickView.error}`)}</p>}

            {quickView && 'product' in quickView && (
              <>
                {quickView.changeRequest && (
                  <div className={`change-request-banner ${quickView.changeRequest.status}`} style={{ marginTop: 14 }}>
                    {tp(quickView.changeRequest.status === 'pending' ? 'changeRequest.pendingBanner' : 'changeRequest.rejectedBanner', {
                      label: changeLabel(tp, quickView.changeRequest),
                      reason: rejectReasonText(quickView.changeRequest.rejectReason) ?? '',
                    })}
                  </div>
                )}

                {quickView.changeRequest?.status === 'pending' && quickView.changeRequest.type === 'edit' && quickView.changeRequest.proposedData && (
                  <div style={{ marginTop: 14 }}>
                    <p style={SECTION_LABEL_STYLE}>{tp('changeRequest.diffTitle')}</p>
                    {(() => {
                      const diff = buildProposalDiff(quickView.product, quickView.changeRequest.proposedData, tp)
                      if (diff.length === 0) return <p className="muted" style={{ fontSize: 12 }}>{tp('changeRequest.diffEmpty')}</p>
                      return (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>{tp('changeRequest.diffField')}</th>
                                <th>{tp('changeRequest.diffBefore')}</th>
                                <th>{tp('changeRequest.diffAfter')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diff.map((d) => (
                                <tr key={d.label}>
                                  <td className="muted">{d.label}</td>
                                  <td>{d.before}</td>
                                  <td style={{ fontWeight: 700, color: '#e56b39' }}>{d.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                )}

                <div className="quick-view-cols">
                  <div>
                    {quickView.display.description && <p className="quick-view-desc">{quickView.display.description}</p>}

                    <div className="quick-view-pair">
                      <div>
                        <p style={SECTION_LABEL_STYLE}>{tp('quickView.conditionsTitle')}</p>
                        <p className="quick-view-line">{tp('confirmType')}: <strong>{tp(`confirm.${quickView.product.confirmType}`)}</strong></p>
                        <p className="quick-view-line">
                          {tp('quickView.deadline')}: <strong>{tp('quickView.deadlineText', { days: quickView.product.deadlineDays, time: quickView.product.deadlineTime })}</strong>
                        </p>
                      </div>
                      <div>
                        <p style={SECTION_LABEL_STYLE}>{tp('priceFrom')}</p>
                        <p style={{ fontSize: 20, fontWeight: 700, margin: '8px 0', color: '#e56b39' }}>
                          {(() => {
                            const base = priceFrom(quickView.display.priceTable)
                            return base === null ? '—' : tp('fromPrice', { price: formatYen(base) })
                          })()}
                        </p>
                      </div>
                    </div>

                    {/* 요금표: 금액이 하나라도 있는 플랜만. 숙박은 플랜 대신 객실별 기본 요금 */}
                    {(() => {
                      const { categories, plans, roomTypes, roomPricing } = quickView.display.priceTable
                      if (roomTypes.length > 0) {
                        return (
                          <table className="quick-view-table">
                            <tbody>
                              {roomTypes.map((r) => (
                                <tr key={r.id}>
                                  <td>{r.name}</td>
                                  <td>{typeof roomPricing.base[r.id]?.price === 'number' ? formatYen(roomPricing.base[r.id].price!) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      }
                      const priced = plans.filter((pl) => categories.some((c) => typeof pl.prices[c.id] === 'number'))
                      if (categories.length === 0 || priced.length === 0) return null
                      return (
                        <table className="quick-view-table">
                          <thead>
                            <tr>
                              <th />
                              {categories.map((c) => (
                                <th key={c.id}>{c.name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {priced.map((pl) => (
                              <tr key={pl.id}>
                                <td>{pl.name}</td>
                                {categories.map((c) => (
                                  <td key={c.id}>{typeof pl.prices[c.id] === 'number' ? formatYen(pl.prices[c.id]!) : '—'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    })()}

                    {quickView.display.cancelRules.length > 0 && (
                      <div style={{ marginTop: 24 }}>
                        <p style={SECTION_LABEL_STYLE}>{tp('cancelPolicy')}</p>
                        {quickView.display.cancelRules.map((r, i) => (
                          <p key={i} className="quick-view-line">
                            {tp('quickView.cancelRule', { days: r.daysBefore, percent: r.percent })}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p style={SECTION_LABEL_STYLE}>{tp('quickView.capacityTitle')}</p>
                    <CapacityCalendar month={quickView.month} capacity={quickView.capacity} onMonthChange={changeQuickViewMonth} loading={monthLoading} />
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="outline-button" onClick={closeQuickView}>
                    {t('common.close')}
                  </button>
                  <Link href={`/products/${quickViewId}`} className="primary-button">
                    {tp('edit')}
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

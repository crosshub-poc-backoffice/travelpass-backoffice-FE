'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { BookingStatus as DbBookingStatus } from '@/lib/bookings/status'
import { usePathname, useRouter } from '@/i18n/navigation'
import { AiText } from '@/components/ai-tag'
import { Pagination } from '@/components/pagination'
import { formatDay, formatJstDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { PAGE_SIZE } from '@/lib/pagination'
import { ACTIVE_BOOKING_STATUSES, BOOKING_LABEL_TO_STATUS, CONFIRM_LABEL_TO_TYPE, DECISION_LABEL_TO_CODE } from '@/lib/bookings/status'
import type { BookingRow } from '@/lib/server/bookings/service'
import { changeBookingStatus, refundBooking, respondToBookingQuote, sendBookingQuote } from './actions'

type BookingStatus = BookingRow['status']

const STATUS_TONE: Record<BookingStatus, string> = {
  업체확인중: 'status-review',
  고객확인중: 'status-review',
  확정: 'status-live',
  거절: 'status-hidden',
  신청취소: 'status-hidden',
  이용완료: 'status-live',
  취소: 'status-hidden',
  환불완료: 'status-hidden',
}

// Korean 버튼 라벨 → 서버 액션에 넘길 DB enum 값
const STATUS_TO_DB = {
  거절: 'rejected',
  이용완료: 'completed',
  취소: 'canceled',
} as const

// 상태 필터 select가 쓰는 DB enum 값 ↔ 표시 라벨
const STATUS_FILTER_OPTIONS: { value: DbBookingStatus; label: BookingStatus }[] = [
  { value: 'pending', label: '업체확인중' },
  { value: 'quoted', label: '고객확인중' },
  { value: 'confirmed', label: '확정' },
  { value: 'canceled', label: '취소' },
  { value: 'completed', label: '이용완료' },
  { value: 'rejected', label: '거절' },
  { value: 'withdrawn', label: '신청취소' },
  { value: 'refunded', label: '환불완료' },
]

const QUOTE_STEP_KEYS = ['apply', 'quote', 'customerConfirm', 'confirmed'] as const

export function BookingsView({
  initialBookings,
  nationalityNames,
  statusCounts,
  initialSelectedId = null,
  total,
  page,
  keyword: initialKeyword,
  status: initialStatus,
  partners,
  partnerId: initialPartnerId,
  products,
  productId: initialProductId,
}: {
  initialBookings: BookingRow[]
  nationalityNames: Record<string, string>
  statusCounts: Partial<Record<DbBookingStatus, number>>
  initialSelectedId?: string | null
  total: number
  page: number
  keyword: string
  status: string
  partners: { id: string; name: string }[]
  partnerId: string
  products: { id: string; name: string; partnerId: string }[]
  productId: string
}) {
  const t = useTranslations()
  const tb = useTranslations('bookings')
  const locale = useLocale()
  // 서버는 status/confirmType/customerDecision을 전부 한글 고정 라벨로 내려준다(서버 계약, 비교문엔 손대지 않음).
  // 화면 표시만 역방향 매핑으로 enum을 되찾아 번역한다.
  const statusLabel = (koreanLabel: string) => {
    const status = BOOKING_LABEL_TO_STATUS[koreanLabel]
    return status ? tb(`status.${status}`) : koreanLabel
  }
  const confirmTypeLabel = (koreanLabel: string) => {
    const type = CONFIRM_LABEL_TO_TYPE[koreanLabel]
    return type ? tb(`confirmType.${type}`) : koreanLabel
  }
  const decisionLabel = (koreanLabel: string) => {
    const code = DECISION_LABEL_TO_CODE[koreanLabel]
    return code ? tb(`decision.${code}`) : koreanLabel
  }
  const router = useRouter()
  const pathname = usePathname()
  const [bookings, setBookings] = useState(initialBookings)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [partnerFilter, setPartnerFilter] = useState(initialPartnerId)
  const [productFilter, setProductFilter] = useState(initialProductId)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [quoteAmount, setQuoteAmount] = useState('')
  const [quoteMessage, setQuoteMessage] = useState('')
  // 환불 완료 처리 패널: 적용할 취소 수수료 (취소표 금액이 기본값, 낮추기만 가능)
  const [refundFee, setRefundFee] = useState<string | null>(null)
  const [cancelDraftOpen, setCancelDraftOpen] = useState<'reject' | 'cancel' | false>(false)
  const [cancelReason, setCancelReason] = useState('')
  const [pending, startTransition] = useTransition()
  const keywordDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 서버 액션 뒤 refresh()로 목록이 다시 내려오면(= initialBookings가 새 배열로 바뀌면) 맞춰준다.
  useEffect(() => {
    setBookings(initialBookings)
  }, [initialBookings])

  useEffect(() => () => {
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
  }, [])

  // keyword·status·partnerId·productId·page는 URL 쿼리로 들고 있다 — 검색·필터·페이지 이동마다 서버에서 다시 조회한다.
  function pushQuery(next: { keyword?: string; status?: string; partnerId?: string; productId?: string; page?: number }) {
    const merged = { keyword, status: statusFilter, partnerId: partnerFilter, productId: productFilter, page, ...next }
    const query: Record<string, string> = {}
    if (merged.keyword) query.keyword = merged.keyword
    if (merged.status && merged.status !== 'active') query.status = merged.status // 진행 중은 기본값이라 주소에 안 남긴다
    if (merged.partnerId && merged.partnerId !== 'all') query.partnerId = merged.partnerId
    if (merged.productId && merged.productId !== 'all') query.productId = merged.productId
    if (merged.page && merged.page > 1) query.page = String(merged.page)
    router.replace({ pathname, query })
  }

  function handleKeywordChange(value: string) {
    setKeyword(value)
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
    keywordDebounce.current = setTimeout(() => pushQuery({ keyword: value, page: 1 }), 400)
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value)
    pushQuery({ status: value, page: 1 })
  }

  // 업체를 바꾸면 그 업체 소속이 아닌 상품 선택은 의미가 없어지니 같이 초기화
  function handlePartnerChange(value: string) {
    setPartnerFilter(value)
    setProductFilter('all')
    pushQuery({ partnerId: value, productId: 'all', page: 1 })
  }

  function handleProductChange(value: string) {
    setProductFilter(value)
    pushQuery({ productId: value, page: 1 })
  }

  const productOptions = partnerFilter === 'all' ? products : products.filter((p) => p.partnerId === partnerFilter)

  const selected = bookings.find((b) => b.id === selectedId) ?? null

  // 오른쪽 칸에 보여줄 게 있을 때만 두 칸(선택 내역·견적·환불). 없으면 한 칸으로 좁게
  const hasSide =
    !!selected &&
    (!!selected.priceBreakdown ||
      (selected.confirmType === '견적확인후확정' && (selected.quoteAmount != null || selected.status === '업체확인중')) ||
      (refundFee !== null && selected.status === '취소') ||
      !!cancelDraftOpen)

  // 다른 예약을 열면 입력 중이던 견적·환불 값을 비운다. 견적 금액은 고객이 신청한 금액에서 시작
  useEffect(() => {
    setQuoteAmount(selected ? String(selected.amount) : '')
    setQuoteMessage('')
    setCancelDraftOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 환불대기(취소) 예약을 열면 환불 처리 칸을 바로 띄운다. 적용 수수료는 취소표 금액에서 시작
  useEffect(() => {
    setRefundFee(selected?.status === '취소' ? String(selected.cancelFee ?? 0) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.status])

  function run(fn: () => Promise<{ error?: 'notFound' | 'invalidAmount' | 'tooLong' }>) {
    startTransition(async () => {
      const result = await fn()
      if (result.error) window.alert(t(`errors.${result.error}`))
    })
  }

  function updateStatus(id: string, status: BookingStatus, reason?: string) {
    run(() => changeBookingStatus(id, STATUS_TO_DB[status as keyof typeof STATUS_TO_DB], reason))
  }

  // 거절(업체확인중 → 거절)·취소(확정 → 취소) 둘 다 운영자가 사유를 직접 적을 수 있게 인라인 패널을 연다
  function openCancelDraft(kind: 'reject' | 'cancel') {
    setCancelReason('')
    setCancelDraftOpen(kind)
  }

  function confirmCancelDraft() {
    if (!selected || !cancelDraftOpen) return
    updateStatus(selected.id, cancelDraftOpen === 'reject' ? '거절' : '취소', cancelReason.trim() || undefined)
    setCancelDraftOpen(false)
  }

  function submitRefund() {
    if (!selected || refundFee === null) return
    run(() => refundBooking(selected.id, Number(refundFee)))
  }

  function sendQuote() {
    if (!selected || !(Number(quoteAmount) > 0)) return
    run(() => sendBookingQuote(selected.id, { amount: Number(quoteAmount), message: quoteMessage }))
  }

  function respondAsCustomer(decision: '수락' | '거절') {
    if (!selected) return
    run(() => respondToBookingQuote(selected.id, decision === '수락' ? 'accepted' : 'declined'))
  }

  // 지금 진행 중인 단계. 이보다 앞은 끝난 단계, 확정 이후는 전부 끝(현재 단계 없음 = 단계 수)
  function quoteStepIndex(b: BookingRow) {
    if (b.status === '업체확인중') return 1 // 신청은 들어왔고 업체가 확인·견적할 차례
    // 견적을 보낸 순간 "업체 확인 및 견적"은 끝났고, 지금은 고객 응답을 기다리는 "고객 확인" 단계다
    if (b.status === '고객확인중') return 2
    if (b.status === '확정' || b.status === '이용완료' || b.status === '환불완료') return QUOTE_STEP_KEYS.length
    return 1
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">BOOKINGS</p>
          <h1>{t('page.bookings.title')}</h1>
        </div>
      </section>

      <div className="card products-card">
        {/* 필터는 접어두지 않는다: 위 줄은 검색·업체·상품, 아래 줄은 상태 칩(한 번에 고르기) */}
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div className="search-box">
            <Search size={17} />
            <input placeholder={tb('searchPlaceholder')} value={keyword} onChange={(e) => handleKeywordChange(e.target.value)} />
          </div>
          {partners.length > 1 && (
            <select className="toolbar-select" value={partnerFilter} onChange={(e) => handlePartnerChange(e.target.value)} aria-label={t('products.partner')}>
              <option value="all">
                {t('products.partner')}: {t('inquiries.statusAll')}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select className="toolbar-select" value={productFilter} onChange={(e) => handleProductChange(e.target.value)} aria-label={tb('productLabel')}>
            <option value="all">
              {tb('productLabel')}: {t('inquiries.statusAll')}
            </option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {/* 진행 중(기본)과 그 3개 상태만 건수를 붙인다. 종료 상태는 쌓이기만 하는 기록이라 건수 없이 찾아보기용 */}
        <div className="filter-chips" role="group" aria-label={tb('statusLabel')}>
          {[
            { value: 'active', label: tb('statusActive') },
            ...STATUS_FILTER_OPTIONS.filter((o) => ACTIVE_BOOKING_STATUSES.includes(o.value)).map((o) => ({
              value: o.value,
              label: statusLabel(o.label),
              count: statusCounts[o.value] ?? 0,
            })),
            null,
            ...STATUS_FILTER_OPTIONS.filter((o) => !ACTIVE_BOOKING_STATUSES.includes(o.value)).map((o) => ({ value: o.value, label: statusLabel(o.label) })),
          ].map((o) =>
            o === null ? (
              <span key="divider" className="filter-chips-divider" />
            ) : (
              <button
                key={o.value}
                type="button"
                className={`filter-chip${statusFilter === o.value ? ' is-active' : ''}`}
                aria-pressed={statusFilter === o.value}
                onClick={() => handleStatusChange(o.value)}
              >
                {o.label}
                {'count' in o && <span className="filter-chip-count">{o.count}</span>}
              </button>
            ),
          )}
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{tb('colUseDate')}</th>
                <th>{t('products.name')}</th>
                <th>{tb('colBuyer')}</th>
                <th>{tb('colPeople')}</th>
                <th>{tb('colAmount')}</th>
                <th>{t('products.statusTitle')}</th>
                <th>{tb('colBookingId')}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDay(b.useDate, locale)}</td>
                  <td>
                    <button className="table-link" onClick={() => setSelectedId(b.id)}>
                      <AiText ai={b.productNameAi}>{b.productName}</AiText>
                    </button>
                  </td>
                  <td>
                    {b.customerName}
                    <span className="muted" style={{ marginLeft: 6 }}>
                      ({nationalityNames[b.nationality] ?? b.nationality})
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{tb('peopleCount', { count: b.people })}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatMoney(b.amount, b.currency)}</td>
                  <td>
                    <span className={`status ${STATUS_TONE[b.status]}`}>
                      <i />
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  {/* 긴 예약번호는 끝 8자리만 (검색은 일부만 넣어도 찾아진다). 전체는 마우스를 올리면 보인다 */}
                  <td className="muted" title={b.id} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>
                    …{b.id.slice(-8)}
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                    {tb('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(next) => pushQuery({ page: next })} />
      </div>

      {selected && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedId(null)}>
          <div className="modal-card" style={{ width: hasSide ? 'min(920px,100%)' : 'min(560px,100%)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <p className="eyebrow">BOOKING DETAIL</p>
                <h2>{selected.id}</h2>
                <p className="heading-sub" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status ${STATUS_TONE[selected.status]}`}>
                    <i />
                    {statusLabel(selected.status)}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {confirmTypeLabel(selected.confirmType)}
                  </span>
                </p>
              </div>
              <button className="close-button" onClick={() => setSelectedId(null)} aria-label={t('common.close')}>
                <X size={19} />
              </button>
            </div>

            {selected.confirmType === '견적확인후확정' && selected.status !== '거절' && selected.status !== '신청취소' && selected.status !== '취소' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 2px', flexWrap: 'wrap' }}>
                {QUOTE_STEP_KEYS.map((s, i) => (
                  <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      className={`status ${i < quoteStepIndex(selected) ? 'status-live' : i === quoteStepIndex(selected) ? 'status-current' : 'status-hidden'}`}
                      style={{ fontSize: 10 }}
                      aria-current={i === quoteStepIndex(selected) ? 'step' : undefined}
                    >
                      <i />
                      {tb(`step.${s}`)}
                    </span>
                    {i < QUOTE_STEP_KEYS.length - 1 && <ChevronRight size={12} color="#c7c9c4" />}
                  </span>
                ))}
              </div>
            )}

            {/* 왼쪽 = 예약 내용, 오른쪽 = 지금 할 일(견적·환불·처리 버튼). 좁은 화면에선 위아래로 */}
            <div className={`booking-detail-grid${hasSide ? '' : ' is-single'}`}>
            <div>
            <div style={{ marginTop: 6 }}>
              {[
                {
                  label: t('products.name'),
                  value: (
                    <>
                      <AiText ai={selected.productNameAi}>{selected.productName}</AiText>
                    </>
                  ),
                },
                { label: t('inquiries.colPartner'), value: selected.partner },
                { label: tb('buyerLabel'), value: `${selected.customerName} (${nationalityNames[selected.nationality] ?? selected.nationality})` },
                { label: tb('useDatePeopleLabel'), value: tb('useDatePeopleValue', { date: formatDay(selected.useDate, locale), count: selected.people }) },
                { label: tb('amountLabel'), value: formatMoney(selected.amount, selected.currency), orange: true },
                // 예약 시점 수수료율로 굳힌 값. 수수료율을 바꿔도 이 예약은 안 바뀐다
                { label: tb('commissionLabel', { rate: selected.commissionRate }), value: formatMoney(selected.commission, selected.currency) },
                { label: tb('netLabel'), value: formatMoney(selected.net, selected.currency) },
                ...(selected.cancelFee != null
                  ? [{ label: tb('cancelFeeRefundLabel'), value: `${formatMoney(selected.cancelFee, selected.currency)} / ${formatMoney(selected.amount - selected.cancelFee, selected.currency)}` }]
                  : []),
                ...(selected.cancelReason ? [{ label: tb('cancelReasonLabel'), value: selected.cancelReason }] : []),
                { label: tb('requestedAtLabel'), value: formatJstDateTime(selected.requestedAt, locale) },
              ].map((f) => (
                <div
                  key={f.label}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0ed' }}
                >
                  <span className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>
                    {f.label}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: f.orange ? '#e56b39' : '#41443f', textAlign: 'right' }}>{f.value}</span>
                </div>
              ))}
            </div>

            </div>

            <div className="booking-detail-side">
            {/* 고객이 고른 요금 구성 (예약 당시 스냅샷) — 견적 낼 때 판단 근거 */}
            {selected.priceBreakdown && (
              <div className="booking-section" style={{ marginTop: 0 }}>
                <p className="booking-section-title">{tb('selectionTitle')}</p>
                <div className="booking-section-row">
                  <span className="muted">{tb('selectionPlan')}</span>
                  <strong>{selected.priceBreakdown.planName || '-'}</strong>
                </div>
                <div className="booking-section-row">
                  <span className="muted">{tb('selectionPeople')}</span>
                  <strong>
                    {selected.priceBreakdown.peopleByCategory
                      .filter((c) => c.count > 0)
                      .map((c) => `${c.categoryName} ${c.count}`)
                      .join(' · ') || tb('peopleCount', { count: selected.people })}
                  </strong>
                </div>
                <div className="booking-section-row">
                  <span className="muted">{tb('selectionOptions')}</span>
                  <strong>
                    {selected.priceBreakdown.selectedOptions.length === 0
                      ? tb('selectionNoOptions')
                      : selected.priceBreakdown.selectedOptions.map((o) => (
                          <span key={o.label} style={{ display: 'block' }}>
                            {o.label} {o.amount !== 0 && <span className="muted">{`${o.amount > 0 ? '+' : ''}${formatMoney(o.amount, selected.currency)}`}</span>}
                          </span>
                        ))}
                  </strong>
                </div>
              </div>
            )}
            {selected.confirmType === '견적확인후확정' && selected.quoteAmount != null && (
              <div className="confirm-box">
                <p style={{ fontWeight: 600, color: '#41443f', margin: '0 0 8px' }}>{tb('quoteBoxTitle')}</p>
                <div className="info-list" style={{ margin: 0 }}>
                  <div>
                    <span>{tb('quoteAmountLabel')}</span>
                    <strong className="orange-text">{formatMoney(selected.quoteAmount, selected.currency)}</strong>
                  </div>
                  {selected.quoteMessage && (
                    <div>
                      <span>{tb('partnerMemoLabel')}</span>
                      <strong>{selected.quoteMessage}</strong>
                    </div>
                  )}
                  <div>
                    <span>{tb('customerReplyLabel')}</span>
                    <strong>{selected.customerDecision ? decisionLabel(selected.customerDecision) : tb('decision.waiting')}</strong>
                  </div>
                </div>
              </div>
            )}

            {selected.status === '업체확인중' && !cancelDraftOpen && (
              <div className="form-card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10 }}>
                <p className="booking-section-title" style={{ marginTop: 0 }}>{tb('quoteFormTitle')}</p>
                <label className="modal-label">
                  {tb('quoteAmountInputLabel', { currency: selected.currency })}
                  <input type="number" min={1} value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} placeholder="0" />
                </label>
                <label className="modal-label">
                  {tb('partnerMemoOptionalLabel')}
                  <textarea value={quoteMessage} onChange={(e) => setQuoteMessage(e.target.value)} placeholder={tb('memoPlaceholder')} />
                </label>
                <div className="form-actions">
                  <button className="outline-button danger" disabled={pending} onClick={() => openCancelDraft('reject')}>
                    {tb('rejectBooking')}
                  </button>
                  <button className="primary-button" disabled={!(Number(quoteAmount) > 0) || pending} onClick={sendQuote}>
                    {tb('sendQuoteConfirm')}
                  </button>
                </div>
              </div>
            )}

            {refundFee !== null && selected.status === '취소' && (() => {
              const ruleFee = selected.cancelFee ?? 0
              const fee = Number(refundFee)
              const valid = refundFee !== '' && Number.isInteger(fee) && fee >= 0 && fee <= ruleFee
              return (
                <div className="form-card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span className="muted">{tb('refundRuleFeeLabel')}</span>
                    <span>{formatMoney(ruleFee, selected.currency)}</span>
                  </div>
                  <label className="modal-label">
                    {tb('refundAppliedFeeLabel', { max: formatMoney(ruleFee, selected.currency) })}
                    <input type="number" min={0} max={ruleFee} step={1} value={refundFee} onChange={(e) => setRefundFee(e.target.value)} />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 12 }}>
                    <span className="muted">{tb('refundAmountLabel')}</span>
                    <strong style={{ color: '#e56b39' }}>{valid ? formatMoney(selected.amount - fee, selected.currency) : '-'}</strong>
                  </div>
                  <div className="form-actions">
                    <button className="primary-button" disabled={!valid || pending} onClick={submitRefund}>
                      {tb('refundComplete')}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* 거절·취소 사유 입력 (선택). 견적 칸·처리 버튼 대신 이 칸만 보여준다 */}
            {cancelDraftOpen && (
              <div className="form-card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10 }}>
                {cancelDraftOpen === 'cancel' && (
                  <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                    {tb('cancelConfirmFee', { amount: formatMoney(selected.cancelFeePreview ?? 0, selected.currency) })}
                    <br />
                    {tb('cancelConfirmRefund', { amount: formatMoney(selected.amount - (selected.cancelFeePreview ?? 0), selected.currency) })}
                  </p>
                )}
                <label className="modal-label">
                  {tb('cancelReasonLabel')}
                  <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={tb('cancelReasonPlaceholder')} />
                </label>
                <div className="form-actions">
                  <button className="outline-button" onClick={() => setCancelDraftOpen(false)}>
                    {t('common.cancel')}
                  </button>
                  <button className="primary-button" disabled={pending} onClick={confirmCancelDraft}>
                    {cancelDraftOpen === 'reject' ? tb('rejectBooking') : tb('cancelBooking')}
                  </button>
                </div>
              </div>
            )}

            </div>
            </div>

            {refundFee === null && selected.status !== '업체확인중' && !cancelDraftOpen && (
              <div className="modal-actions" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 20 }}>
                {selected.status === '고객확인중' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                    <span className="muted" style={{ fontSize: 10 }}>
                      {tb('quoteSimulationHint')}
                    </span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="primary-button" disabled={pending} onClick={() => respondAsCustomer('수락')}>
                        {tb('simulateAccept')}
                      </button>
                      <button className="outline-button danger" disabled={pending} onClick={() => respondAsCustomer('거절')}>
                        {tb('simulateDecline')}
                      </button>
                    </div>
                  </div>
                )}
                {selected.status === '확정' && (
                  <>
                    <button className="primary-button" disabled={pending} onClick={() => updateStatus(selected.id, '이용완료')}>
                      {tb('completeBooking')}
                    </button>
                    <button className="outline-button danger" disabled={pending} onClick={() => openCancelDraft('cancel')}>
                      {tb('cancelBooking')}
                    </button>
                  </>
                )}
                {(selected.status === '이용완료' || selected.status === '환불완료' || selected.status === '거절' || selected.status === '신청취소') && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {tb('doneHint')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

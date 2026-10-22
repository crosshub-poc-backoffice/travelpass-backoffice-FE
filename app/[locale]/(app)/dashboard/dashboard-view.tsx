'use client'

import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight, Plus } from 'lucide-react'
import { type InquiryLanguageCode } from '@/lib/inquiry-language'
import type { BookingRow } from '@/lib/server/bookings/service'
import type { PendingInquiryRow } from '@/lib/server/inquiries/service'
import type { PendingSettlementRow } from '@/lib/server/settlements/service'
import type { PendingChangeRequestRow } from '@/lib/server/products/change-requests'
import type { ReviewProductRow } from '@/lib/server/products/service'
import { formatMoney } from '@/lib/money'
import { formatDay, formatJstDate, formatMonth } from '@/lib/datetime'

export function DashboardView({
  roleName,
  canCreate,
  isCrosshub,
  bookings,
  bookingsTotal,
  refundRows,
  refundTotal,
  inquiries,
  inquiriesTotal,
  payouts,
  showPartnerColumn,
  reviewProducts,
  reviewTotal,
  changeRequests,
  changeRequestTotal,
  payoutRows,
}: {
  roleName: string
  canCreate: boolean
  isCrosshub: boolean
  bookings: BookingRow[]
  bookingsTotal: number
  refundRows: BookingRow[]
  refundTotal: number
  inquiries: PendingInquiryRow[]
  inquiriesTotal: number
  payouts: { currency: string; net: number; payDate: string }[]
  showPartnerColumn: boolean
  reviewProducts: ReviewProductRow[]
  reviewTotal: number
  changeRequests: PendingChangeRequestRow[]
  changeRequestTotal: number
  payoutRows: (PendingSettlementRow & { payDate: string })[]
}) {
  const t = useTranslations()
  const td = useTranslations('dashboard')
  const tq = useTranslations('inquiries')
  const locale = useLocale()
  const router = useRouter()
  const formatDate = (iso: string) => formatJstDate(iso, locale)
  const languageDisplay = (code: InquiryLanguageCode) => tq(`language.${code}`)

  const tp = useTranslations('products')
  const changeLabel = (r: PendingChangeRequestRow) =>
    r.type === 'edit'
      ? tp('changeRequest.labelEdit')
      : r.type === 'delete'
        ? tp('changeRequest.labelDelete')
        : tp(r.targetStatus === 'live' ? 'changeRequest.labelShow' : 'changeRequest.labelHide')

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>
            {t('greeting.helloName', { name: roleName })}
          </h1>
          {/* 업체·연맹: 할 일이 아니라 안내라서 카드 밖, 인사말 아래 한 줄로 */}
          {!isCrosshub && (
            <Link href="/settlements" className="dash-payout">
              {payouts.length === 0
                ? td('noPayout')
                : payouts.map((p) => (
                    <span key={p.currency}>
                      {td('payoutTitle')} {formatDay(p.payDate, locale)} <b>{formatMoney(p.net, p.currency)}</b>
                    </span>
                  ))}
              <ChevronRight size={13} />
            </Link>
          )}
        </div>
        {canCreate && (
          <Link href="/products/new" className="primary-button">
            <Plus size={18} /> {td('newProduct')}
          </Link>
        )}
      </section>

      {isCrosshub ? (
        // 크로스허브: 크로스허브만 하는 일 3개 — 등록심사, 변경요청 승인, 정산 지급
        <div className="dash-grid">
          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>
                {td('todoReview')} <em className={reviewTotal ? '' : 'is-zero'}>{reviewTotal}</em>
              </h2>
              <Link href={{ pathname: '/products', query: { status: 'review' } }} className="text-link">
                {td('viewAll')}
              </Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('products.name')}</th>
                    <th>{tq('colPartner')}</th>
                    <th>{td('colRegisteredAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewProducts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                        {td('noReviews')}
                      </td>
                    </tr>
                  )}
                  {reviewProducts.map((p) => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/products?status=review&id=${p.id}`)}>
                      <td className="dash-product">
                        <strong>
                          <AiText ai={p.nameAi}>{p.name}</AiText>
                        </strong>
                      </td>
                      <td>{p.partnerName}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>
                {td('todoChangeRequest')} <em className={changeRequestTotal ? '' : 'is-zero'}>{changeRequestTotal}</em>
              </h2>
              <Link href={{ pathname: '/products', query: { status: 'changeRequest' } }} className="text-link">
                {td('viewAll')}
              </Link>
            </div>
            {changeRequests.length === 0 ? (
              <p className="muted dash-empty">{td('noChangeRequests')}</p>
            ) : (
              <ul className="dash-list">
                {changeRequests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/products?status=changeRequest&id=${r.productId}`}>
                      <span>
                        <strong>
                          <AiText ai={r.productNameAi}>{r.productName}</AiText>
                        </strong>
                        <small>
                          {r.partnerName}, {changeLabel(r)}
                        </small>
                      </span>
                      <time>{formatDate(r.createdAt)}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dash-card dash-wide">
            <div className="dash-card-head">
              <h2>
                {td('todoPayout')} <em className={payoutRows.length ? '' : 'is-zero'}>{payoutRows.length}</em>
              </h2>
              <Link href="/settlements" className="text-link">
                {td('viewAll')}
              </Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tq('colPartner')}</th>
                    <th>{td('colPeriod')}</th>
                    <th>{td('colNet')}</th>
                    <th>{td('colPayDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                        {td('noSettlements')}
                      </td>
                    </tr>
                  )}
                  {payoutRows.map((s) => (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/settlements?month=${s.period}`)}>
                      <td className="dash-product">
                        <strong>{s.partnerName}</strong>
                      </td>
                      <td>{formatMonth(s.period, locale)}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatMoney(s.net, s.currency)}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDay(s.payDate, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <>
          {/* 업체·연맹: 왼쪽 = 주 업무(견적 보낼 예약), 오른쪽 = 답변할 문의 + 환불·지급 */}
          <div className="dash-grid">
            <section className="card dash-card">
              <div className="dash-card-head">
                <h2>
                  {td('todoQuote')} <em className={bookingsTotal ? '' : 'is-zero'}>{bookingsTotal}</em>
                </h2>
                <Link href={{ pathname: '/bookings', query: { status: 'pending' } }} className="text-link">
                  {td('viewAll')}
                </Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('products.name')}</th>
                      <th>{td('colUseDate')}</th>
                      <th>{td('colPeople')}</th>
                      <th>{td('colRequestedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                          {td('noBookings')}
                        </td>
                      </tr>
                    )}
                    {bookings.map((b) => (
                      <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/bookings?id=${b.id}`)}>
                        <td className="dash-product">
                          <strong>
                            <AiText ai={b.productNameAi}>{b.productName}</AiText>
                          </strong>
                          {showPartnerColumn && <small>{b.partner}</small>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDay(b.useDate, locale)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{td('peopleCount', { count: b.people })}</td>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(b.requestedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

              <section className="card dash-card">
                <div className="dash-card-head">
                  <h2>
                    {td('todoInquiry')} <em className={inquiriesTotal ? '' : 'is-zero'}>{inquiriesTotal}</em>
                  </h2>
                  <Link href={{ pathname: '/inquiries', query: { status: 'pending' } }} className="text-link">
                    {td('viewAll')}
                  </Link>
                </div>
                {inquiries.length === 0 ? (
                  <p className="muted dash-empty">{td('noInquiries')}</p>
                ) : (
                  <ul className="dash-list">
                    {inquiries.map((q) => (
                      <li key={q.id}>
                        <Link href={`/inquiries?id=${q.id}`}>
                          <span>
                            <strong>{q.customerName}</strong>
                            <small>{showPartnerColumn ? `${q.partnerName}, ${languageDisplay(q.language as InquiryLanguageCode)}` : languageDisplay(q.language as InquiryLanguageCode)}</small>
                          </span>
                          <time>{formatDate(q.createdAt)}</time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

            <section className="card dash-card dash-wide">
              <div className="dash-card-head">
                <h2>
                  {td('todoRefund')} <em className={refundTotal ? '' : 'is-zero'}>{refundTotal}</em>
                </h2>
                <Link href={{ pathname: '/bookings', query: { status: 'canceled' } }} className="text-link">
                  {td('viewAll')}
                </Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('products.name')}</th>
                      <th>{td('colCustomer')}</th>
                      <th>{td('colUseDate')}</th>
                      <th>{td('colRefundAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refundRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                          {td('noRefunds')}
                        </td>
                      </tr>
                    )}
                    {refundRows.map((b) => (
                      <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/bookings?id=${b.id}`)}>
                        <td className="dash-product">
                          <strong>
                            <AiText ai={b.productNameAi}>{b.productName}</AiText>
                          </strong>
                          {showPartnerColumn && <small>{b.partner}</small>}
                        </td>
                        <td>{b.customerName}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDay(b.useDate, locale)}</td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatMoney(b.amount - (b.cancelFee ?? 0), b.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  )
}

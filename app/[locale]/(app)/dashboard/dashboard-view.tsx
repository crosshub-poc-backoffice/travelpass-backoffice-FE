'use client'

import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { type InquiryLanguageCode } from '@/lib/inquiry-language'
import type { PendingInquiryRow } from '@/lib/server/inquiries/service'
import type { PendingChangeRequestRow } from '@/lib/server/products/change-requests'
import type { ReviewProductRow } from '@/lib/server/products/service'
import { formatJstDate } from '@/lib/datetime'

export function DashboardView({
  roleName,
  canCreate,
  isCrosshub,
  inquiries,
  inquiriesTotal,
  showPartnerColumn,
  reviewProducts,
  reviewTotal,
  changeRequests,
  changeRequestTotal,
}: {
  roleName: string
  canCreate: boolean
  isCrosshub: boolean
  inquiries: PendingInquiryRow[]
  inquiriesTotal: number
  showPartnerColumn: boolean
  reviewProducts: ReviewProductRow[]
  reviewTotal: number
  changeRequests: PendingChangeRequestRow[]
  changeRequestTotal: number
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
        </div>
        {canCreate && (
          <Link href="/products/new" className="primary-button">
            <Plus size={18} /> {td('newProduct')}
          </Link>
        )}
      </section>

      {isCrosshub ? (
        // 크로스허브: 크로스허브만 하는 일 2개 — 등록심사, 변경요청 승인
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
        </div>
      ) : (
        // 업체·연맹: 답변할 문의
        <div className="dash-grid">
          <section className="card dash-card dash-wide">
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
        </div>
      )}
    </>
  )
}

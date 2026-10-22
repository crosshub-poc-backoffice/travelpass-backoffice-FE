'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { formatMoney } from '@/lib/money'
import { PAGE_SIZE } from '@/lib/pagination'
import { PAYMENT_TYPES } from '@/lib/settlements'
import type { PaymentFilter, PaymentRow } from '@/lib/server/payments/service'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

// 결제내역: PG 거래 1건 = 1행 (결제·환불). 검색 조건은 주소(?tab=payments&from=&to=&type=)에 담는다
export function PaymentsView({ rows, total, filter }: { rows: PaymentRow[]; total: number; filter: PaymentFilter }) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const query: Record<string, string> = { tab: 'payments', from: filter.from, to: filter.to }
  if (filter.type) query.type = filter.type

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'payments' }
    for (const key of ['from', 'to', 'type']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/settlements', query: next })
  }

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <DateField name="from" defaultValue={filter.from} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} ariaLabel={t('audit.to')} />
        <select name="type" defaultValue={filter.type ?? ''} aria-label={t('settlements.payments.colType')}>
          <option value="">{t('settlements.payments.allTypes')}</option>
          {PAYMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`settlements.payments.type.${type}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href={{ pathname: '/settlements', query: { tab: 'payments' } }} className="outline-button">
          {t('common.reset')}
        </Link>
        <span className="total">{t('common.totalCount', { count: total })}</span>
      </form>

      <div className="table-wrap">
        <table>
          <thead style={{ whiteSpace: 'nowrap' }}>
            <tr>
              <th>{t('settlements.payments.colTime')}</th>
              <th>{t('settlements.payments.colBooking')}</th>
              <th>{t('settlements.colPartner')}</th>
              <th>{t('settlements.payments.colProduct')}</th>
              <th>{t('settlements.payments.colType')}</th>
              <th>{t('settlements.payments.colAmount')}</th>
              <th>{t('settlements.payments.colPg')}</th>
              <th>{t('settlements.payments.colTxn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>{t('settlements.payments.empty')}</td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="muted">{formatDateTime(p.createdAt)}</td>
                <td>{p.bookingId}</td>
                <td>{p.partner}</td>
                <td>
                  <AiText ai={p.productNameAi}>{p.productName}</AiText>
                </td>
                <td>
                  <span className={`status ${p.type === 'payment' ? 'status-live' : 'status-hidden'}`}>
                    <i />
                    {t(`settlements.payments.type.${p.type}`)}
                  </span>
                </td>
                <td>
                  <strong>{formatMoney(p.type === 'refund' ? -p.amount : p.amount, p.currency)}</strong>
                </td>
                <td>{p.pg}</td>
                <td className="muted">{p.pgTransactionId ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={filter.page} pageSize={PAGE_SIZE} total={total} pathname="/settlements" query={query} />
    </div>
  )
}

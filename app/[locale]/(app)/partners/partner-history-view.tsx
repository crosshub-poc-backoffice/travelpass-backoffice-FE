'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/audit'
import type { LogFilter, PartnerHistoryRow } from '@/lib/server/audit/service'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

const PARTNER_ACTIONS = AUDIT_ACTIONS.filter((a) => a.startsWith('partner_'))

type PartnerRef = { id: string; name: string }

// 업체 작업 이력 (업체 관리 탭). 업체 등록·수수료율 변경·활성/비활성만 남는다
export function PartnerHistoryView({
  rows,
  total,
  filter,
  pageSize,
  partners,
}: {
  rows: PartnerHistoryRow[]
  total: number
  filter: LogFilter & { partnerId: string | null; action: AuditAction | null }
  pageSize: number
  partners: PartnerRef[]
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)
  const rate = (v: unknown) => (v === null || v === undefined ? '-' : `${v}%`)

  const query: Record<string, string> = { tab: 'history', from: filter.from, to: filter.to }
  if (filter.partnerId) query.partner = filter.partnerId
  if (filter.action) query.action = filter.action

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'history' }
    for (const key of ['from', 'to', 'partner', 'action']) {
      const value = String(form.get(key) ?? '')
      if (value) next[key] = value
    }
    router.push({ pathname: '/partners', query: next })
  }

  const firstNo = total - (filter.page - 1) * pageSize

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <DateField name="from" defaultValue={filter.from} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} ariaLabel={t('audit.to')} />
        <select name="partner" defaultValue={filter.partnerId ?? ''} aria-label={t('audit.colPartner')}>
          <option value="">{t('audit.allPartners')}</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="action" defaultValue={filter.action ?? ''} aria-label={t('audit.colAction')}>
          <option value="">{t('audit.allCategories')}</option>
          {PARTNER_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`audit.action.${a}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href={{ pathname: '/partners', query: { tab: 'history' } }} className="outline-button">
          {t('common.reset')}
        </Link>
        <span className="total">{t('common.totalCount', { count: total })}</span>
      </form>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>No</th>
              <th>{t('audit.colPartner')}</th>
              <th>{t('audit.colAction')}</th>
              <th>{t('accounts.change.colBefore')}</th>
              <th>{t('accounts.change.colAfter')}</th>
              <th>{t('accounts.change.colActor')}</th>
              <th>{t('audit.colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>{t('audit.empty')}</td>
              </tr>
            )}
            {rows.map((r, i) => {
              const change = r.detail?.commissionRate
              return (
                <tr key={r.id}>
                  <td className="muted">{firstNo - i}</td>
                  <td>{r.partnerName}</td>
                  <td>{t(`audit.action.${r.action}`)}</td>
                  <td className="muted">{change ? rate(change[0]) : '-'}</td>
                  <td>{change ? <strong>{rate(change[1])}</strong> : '-'}</td>
                  <td>
                    {r.actorName} ({r.actorLoginId})
                  </td>
                  <td className="muted">{formatDateTime(r.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/partners" query={query} page={filter.page} total={total} pageSize={pageSize} />
    </div>
  )
}

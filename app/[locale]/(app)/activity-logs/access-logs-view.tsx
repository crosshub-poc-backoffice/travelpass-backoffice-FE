'use client'

import { Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { ACCESS_KINDS, type AccessKind } from '@/lib/audit'
import type { AccessLogRow, LogFilter } from '@/lib/server/audit/service'
import { describeUserAgent } from '@/lib/user-agent'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

// 목록·조회는 회색, 등록·수정은 주황, 삭제는 빨강
const KIND_CLASS: Record<AccessKind, string> = {
  list: 'status-hidden',
  view: 'status-hidden',
  create: 'status-review',
  update: 'status-review',
  delete: 'status-failed',
}

export function AccessLogsView({
  rows,
  total,
  filter,
  menus,
  pageSize,
}: {
  rows: AccessLogRow[]
  total: number
  filter: LogFilter & { menu: string | null; kind: AccessKind | null }
  menus: string[]
  pageSize: number
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale, { seconds: true })

  // 목록 번호: 최신 기록이 가장 큰 번호
  const firstNo = total - (filter.page - 1) * pageSize

  const query: Record<string, string> = { tab: 'access', from: filter.from, to: filter.to }
  if (filter.menu) query.menu = filter.menu
  if (filter.kind) query.kind = filter.kind
  if (filter.keyword) query.q = filter.keyword

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'access' }
    for (const key of ['from', 'to', 'menu', 'kind', 'q']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/activity-logs', query: next })
  }

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <DateField name="from" defaultValue={filter.from} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} ariaLabel={t('audit.to')} />
        <select name="menu" defaultValue={filter.menu ?? ''} aria-label={t('audit.colMenu')}>
          <option value="">{t('audit.allMenus')}</option>
          {menus.map((m) => (
            <option key={m} value={m}>
              {t(`nav.${m}`)}
            </option>
          ))}
        </select>
        <select name="kind" defaultValue={filter.kind ?? ''} aria-label={t('audit.colKind')}>
          <option value="">{t('audit.allKinds')}</option>
          {ACCESS_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`audit.kind.${k}`)}
            </option>
          ))}
        </select>
        <div className="search-box">
          <Search size={17} />
          <input name="q" defaultValue={filter.keyword} maxLength={50} placeholder={t('accounts.searchPlaceholder')} />
        </div>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href={{ pathname: '/activity-logs', query: { tab: 'access' } }} className="outline-button">
          {t('common.reset')}
        </Link>
        <span className="total">{t('common.totalCount', { count: total })}</span>
      </form>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 12px' }}>
        {t('audit.accessRetention')}
      </p>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>No</th>
              <th>{t('audit.colUser')}</th>
              <th>{t('audit.colKind')}</th>
              <th>{t('audit.colMenu')}</th>
              <th>IP</th>
              <th>{t('audit.colDevice')}</th>
              <th>{t('audit.colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>{t('audit.empty')}</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="muted">{firstNo - i}</td>
                <td>
                  {r.userName} ({r.userLoginId})
                </td>
                <td>
                  <span className={`status ${KIND_CLASS[r.kind]}`}>
                    <i />
                    {t(`audit.kind.${r.kind}`)}
                  </span>
                </td>
                <td>
                  {t(`nav.${r.menu}`)}
                  {r.path && <div className="audit-change">{r.path}</div>}
                </td>
                <td className="muted">{r.ip ?? '-'}</td>
                <td className="muted">{describeUserAgent(r.userAgent)}</td>
                <td className="muted">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/activity-logs" query={query} page={filter.page} total={total} pageSize={pageSize} />
    </div>
  )
}

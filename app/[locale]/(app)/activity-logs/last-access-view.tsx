'use client'

import { Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { ACCOUNT_STATUSES } from '@/lib/accounts'
import { ROLES } from '@/lib/permissions'
import type { AccountFilter, AccountRow } from '@/lib/server/accounts/service'
import { describeUserAgent } from '@/lib/user-agent'
import { formatJstDateTime } from '@/lib/datetime'

const STATUS_KEY = { active: 'accounts.statusActive', pending: 'accounts.statusPending', inactive: 'accounts.statusInactive' } as const

// 최종 접속내역. 계정마다 마지막으로 로그인한 시각·IP·환경을 최근 순으로 보여준다
export function LastAccessView({
  accounts,
  total,
  filter,
  pageSize,
}: {
  accounts: AccountRow[]
  total: number
  filter: AccountFilter
  pageSize: number
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)

  const query: Record<string, string> = { tab: 'lastAccess' }
  if (filter.role) query.role = filter.role
  if (filter.status) query.status = filter.status
  if (filter.keyword) query.q = filter.keyword

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'lastAccess' }
    for (const key of ['role', 'status', 'q']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/activity-logs', query: next })
  }

  const firstNo = total - (filter.page - 1) * pageSize

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <select name="role" defaultValue={filter.role ?? ''} aria-label={t('accounts.colRole')}>
          <option value="">{t('accounts.allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}`)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filter.status ?? ''} aria-label={t('accounts.colStatus')}>
          <option value="">{t('accounts.allStatuses')}</option>
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_KEY[s])}
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
        <Link href={{ pathname: '/activity-logs', query: { tab: 'lastAccess' } }} className="outline-button">
          {t('common.reset')}
        </Link>
        <span className="total">{t('common.totalCount', { count: total })}</span>
      </form>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>No</th>
              <th>{t('audit.colUser')}</th>
              <th>{t('accounts.colRole')}</th>
              <th>{t('accounts.colLastLogin')}</th>
              <th>IP</th>
              <th>{t('audit.colDevice')}</th>
              <th>{t('accounts.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={7}>{t('accounts.empty')}</td>
              </tr>
            )}
            {accounts.map((a, i) => (
              <tr key={a.id}>
                <td className="muted">{firstNo - i}</td>
                <td>
                  {a.name} ({a.loginId})
                </td>
                <td>{t(`role.${a.role}`)}</td>
                <td>{a.lastLoginAt ? formatDateTime(a.lastLoginAt) : '-'}</td>
                <td className="muted">{a.lastLoginIp ?? '-'}</td>
                <td className="muted">{a.lastLoginUserAgent ? describeUserAgent(a.lastLoginUserAgent) : '-'}</td>
                <td>
                  <span className={`status ${!a.active ? 'status-hidden' : a.pending ? 'status-review' : 'status-live'}`}>
                    <i />
                    {t(!a.active ? 'accounts.statusInactive' : a.pending ? 'accounts.statusPending' : 'accounts.statusActive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/activity-logs" query={query} page={filter.page} total={total} pageSize={pageSize} />
    </div>
  )
}

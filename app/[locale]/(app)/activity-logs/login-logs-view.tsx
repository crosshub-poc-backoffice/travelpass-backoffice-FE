'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { LOGIN_ACTIONS, LOGIN_RESULTS, LOGIN_SEARCH_FIELDS } from '@/lib/audit'
import type { LoginLogFilter, LoginLogRow } from '@/lib/server/audit/service'
import { describeUserAgent } from '@/lib/user-agent'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

// 로그인 내역. 저장값(login·logout·failed)을 액션·결과 두 칸으로 나눠 보여준다
export function LoginLogsView({
  rows,
  total,
  filter,
  pageSize,
}: {
  rows: LoginLogRow[]
  total: number
  filter: LoginLogFilter
  pageSize: number
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale, { seconds: true })

  const query: Record<string, string> = { tab: 'logins', from: filter.from, to: filter.to }
  if (filter.action) query.action = filter.action
  if (filter.result) query.result = filter.result
  if (filter.keyword) {
    query.field = filter.field
    query.q = filter.keyword
    if (filter.exact) query.exact = '1'
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'logins' }
    for (const key of ['from', 'to', 'action', 'result', 'field', 'q', 'exact']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/activity-logs', query: next })
  }

  // 목록 번호: 최신 기록이 가장 큰 번호
  const firstNo = total - (filter.page - 1) * pageSize

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <DateField name="from" defaultValue={filter.from} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} ariaLabel={t('audit.to')} />
        <select name="action" defaultValue={filter.action ?? ''} aria-label={t('audit.colLoginAction')}>
          <option value="">{t('audit.allLoginActions')}</option>
          {LOGIN_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`audit.loginAction.${a}`)}
            </option>
          ))}
        </select>
        <select name="result" defaultValue={filter.result ?? ''} aria-label={t('audit.colResult')}>
          <option value="">{t('audit.allResults')}</option>
          {LOGIN_RESULTS.map((r) => (
            <option key={r} value={r}>
              {t(`audit.result.${r}`)}
            </option>
          ))}
        </select>
        <select name="field" defaultValue={filter.field} aria-label={t('audit.searchField')}>
          {LOGIN_SEARCH_FIELDS.map((f) => (
            <option key={f} value={f}>
              {t(`audit.searchBy.${f}`)}
            </option>
          ))}
        </select>
        <div className="search-box">
          <input name="q" defaultValue={filter.keyword} maxLength={50} placeholder={t('audit.keywordPlaceholder')} />
        </div>
        <label className="check-label">
          <input type="checkbox" name="exact" value="1" defaultChecked={filter.exact} />
          {t('audit.exact')}
        </label>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href={{ pathname: '/activity-logs', query: { tab: 'logins' } }} className="outline-button">
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
              <th>{t('audit.colLoginAction')}</th>
              <th>{t('audit.colResult')}</th>
              <th>IP</th>
              <th>{t('audit.colDevice')}</th>
              <th>{t('audit.colFailReason')}</th>
              <th>{t('audit.colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>{t('audit.empty')}</td>
              </tr>
            )}
            {rows.map((r, i) => {
              const failed = r.event === 'failed'
              return (
                <tr key={r.id}>
                  <td className="muted">{firstNo - i}</td>
                  <td>{r.userName ? `${r.userName} (${r.loginId})` : r.loginId}</td>
                  <td>{t(`audit.loginAction.${r.event === 'logout' ? 'logout' : 'login'}`)}</td>
                  <td>
                    <span className={`status ${failed ? 'status-failed' : 'status-live'}`}>
                      <i />
                      {t(`audit.result.${failed ? 'failed' : 'success'}`)}
                    </span>
                  </td>
                  <td className="muted">{r.ip ?? '-'}</td>
                  <td className="muted">{describeUserAgent(r.userAgent)}</td>
                  <td>{r.failReason ? t(`audit.failReason.${r.failReason}`) : '-'}</td>
                  <td className="muted">{formatDateTime(r.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/activity-logs" query={query} page={filter.page} total={total} pageSize={pageSize} />
    </div>
  )
}

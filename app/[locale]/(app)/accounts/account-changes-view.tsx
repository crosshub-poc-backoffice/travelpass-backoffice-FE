'use client'

import { Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/audit'
import type { AccountChangeRow, LogFilter } from '@/lib/server/audit/service'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

const ACCOUNT_ACTIONS = AUDIT_ACTIONS.filter((a) => a.startsWith('account_'))

// 변동 종류별로 "항목 · 이전값 → 새값"을 정한다. 비밀번호 값은 남기지 않으므로 무엇을 했는지만 보여준다
const CHANGE: Record<string, { field: string; before: string | null; after: string }> = {
  account_issue: { field: 'account', before: null, after: 'issued' },
  account_password_reset: { field: 'password', before: null, after: 'reset' },
  account_password_change: { field: 'password', before: null, after: 'changed' },
  account_deactivate: { field: 'status', before: 'active', after: 'inactive' },
  account_activate: { field: 'status', before: 'inactive', after: 'active' },
}

// 계정 변동 이력. 누구 계정이 어떻게 바뀌었고 누가 바꿨는지 (계정 관리 탭)
export function AccountChangesView({
  rows,
  total,
  filter,
  pageSize,
}: {
  rows: AccountChangeRow[]
  total: number
  filter: LogFilter & { action: AuditAction | null }
  pageSize: number
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)

  const query: Record<string, string> = { tab: 'changes', from: filter.from, to: filter.to }
  if (filter.action) query.action = filter.action
  if (filter.keyword) query.q = filter.keyword

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = { tab: 'changes' }
    for (const key of ['from', 'to', 'action', 'q']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/accounts', query: next })
  }

  const firstNo = total - (filter.page - 1) * pageSize
  const valueText = (v: string | null) => (v ? t(`accounts.change.value.${v}`) : '-')

  return (
    <div className="card products-card">
      <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
        <DateField name="from" defaultValue={filter.from} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} ariaLabel={t('audit.to')} />
        <select name="action" defaultValue={filter.action ?? ''} aria-label={t('accounts.change.colType')}>
          <option value="">{t('accounts.change.allTypes')}</option>
          {ACCOUNT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`audit.action.${a}`)}
            </option>
          ))}
        </select>
        <div className="search-box">
          <Search size={17} />
          <input name="q" defaultValue={filter.keyword} maxLength={50} placeholder={t('accounts.change.searchPlaceholder')} />
        </div>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href={{ pathname: '/accounts', query: { tab: 'changes' } }} className="outline-button">
          {t('common.reset')}
        </Link>
        <span className="total">{t('common.totalCount', { count: total })}</span>
      </form>

      <div className="table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>No</th>
              <th>{t('accounts.change.colTarget')}</th>
              <th>{t('accounts.change.colType')}</th>
              <th>{t('accounts.change.colField')}</th>
              <th>{t('accounts.change.colBefore')}</th>
              <th>{t('accounts.change.colAfter')}</th>
              <th>{t('accounts.change.colActor')}</th>
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
              const change = CHANGE[r.action]
              return (
                <tr key={r.id}>
                  <td className="muted">{firstNo - i}</td>
                  <td>{r.targetName ? `${r.targetName} (${r.targetLoginId})` : (r.targetLoginId ?? '-')}</td>
                  <td>{t(`audit.action.${r.action}`)}</td>
                  <td>{change ? t(`accounts.change.field.${change.field}`) : '-'}</td>
                  <td className="muted">{change ? valueText(change.before) : '-'}</td>
                  <td>{change ? valueText(change.after) : '-'}</td>
                  <td>{r.bySelf ? t('accounts.change.self') : `${r.actorName} (${r.actorLoginId})`}</td>
                  <td className="muted">{formatDateTime(r.createdAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination pathname="/accounts" query={query} page={filter.page} total={total} pageSize={pageSize} />
    </div>
  )
}

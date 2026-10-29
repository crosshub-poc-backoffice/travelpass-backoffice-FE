'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { AUDIT_CATEGORIES, type AuditDetail } from '@/lib/audit'
import type { AuditFilter, AuditRow } from '@/lib/server/audit/service'
import { formatJstDateTime } from '@/lib/datetime'
import { DateField } from '@/components/date-fields'

type PartnerRef = { id: string; name: string }

export function AuditLogsView({
  rows,
  total,
  filter,
  pageSize,
  partners,
}: {
  rows: AuditRow[]
  total: number
  filter: AuditFilter
  pageSize: number
  partners: PartnerRef[]
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()

  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)

  // 지금 검색 조건 (페이지 번호를 바꿀 때 그대로 넘긴다)
  const query: Record<string, string> = { from: filter.from, to: filter.to }
  if (filter.partnerId) query.partner = filter.partnerId
  if (filter.category) query.category = filter.category

  // 검색하면 1페이지부터 다시 본다
  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = {}
    for (const key of ['from', 'to', 'partner', 'category']) {
      const value = String(form.get(key) ?? '')
      if (value) next[key] = value
    }
    router.push({ pathname: '/activity-logs', query: next })
  }

  // 목록 번호: 최신 기록이 가장 큰 번호
  const firstNo = total - (filter.page - 1) * pageSize

  // 바뀐 값 표시. 상품 상태는 상태 이름으로
  function formatValue(field: string, value: unknown) {
    if (value === null || value === undefined) return '-'
    if (field === 'status') return t(`products.status.${value}`)
    // 사업자등록증은 긴 URL 대신 파일 이름만
    if (field === 'businessLicenseUrl') return String(value).split('/').pop()
    return String(value)
  }

  function renderChange(detail: AuditDetail | null) {
    if (!detail) return null
    return Object.entries(detail).map(([field, [before, after]]) => (
      <div key={field} className="audit-change">
        {t(`audit.field.${field}`)}: {formatValue(field, before)} → <b>{formatValue(field, after)}</b>
      </div>
    ))
  }

  return (
    <div className="card products-card">
      {/* key: 초기화·뒤로가기로 조건이 바뀌면 입력칸도 새 조건으로 다시 채운다 */}
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
        <select name="category" defaultValue={filter.category ?? ''} aria-label={t('audit.colAction')}>
          <option value="">{t('audit.allCategories')}</option>
          {AUDIT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`audit.category.${c}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <Link href="/activity-logs" className="outline-button">
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
              <th>{t('audit.colAction')}</th>
              <th>{t('audit.colTarget')}</th>
              <th>{t('audit.colPartner')}</th>
              <th>{t('audit.colTime')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>{t('audit.empty')}</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="muted">{firstNo - i}</td>
                <td>
                  {r.userName} ({r.userLoginId})
                  {/* 연맹이 대행 업체 일을 처리한 건지 구분되도록 역할·소속을 같이 보여준다 */}
                  <div className="audit-change">
                    {t(`role.${r.userRole}`)}
                    {r.userOrgName ? ` · ${r.userOrgName}` : ''}
                  </div>
                </td>
                <td>{t(`audit.action.${r.action}`)}</td>
                <td>
                  {r.targetName ? <AiText ai={r.targetNameAi}>{r.targetName}</AiText> : r.action === 'scope_switch' ? t('audit.allPartners') : '-'}
                  {renderChange(r.detail)}
                </td>
                <td>{r.partnerName ?? '-'}</td>
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

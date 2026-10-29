'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { Ban, Check, KeyRound, Plus, Search, X } from 'lucide-react'
import { issueAccount, resetPassword, toggleActive, type IssueState } from './actions'
import { useSession } from '@/lib/role-context'
import type { AccountFilter, AccountRow } from '@/lib/server/accounts/service'
import { ACCOUNT_STATUSES, ACCOUNT_TABS, type AccountTab, NEW_AFFILIATE } from '@/lib/accounts'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { PageTabs } from '@/components/page-tabs'
import { describeUserAgent } from '@/lib/user-agent'
import { ROLES, type Role } from '@/lib/permissions'
import { useLocale, useTranslations } from 'next-intl'
import type { ErrorKey } from '@/lib/errors'
import { formatJstDate, formatJstDateTime } from '@/lib/datetime'

type Org = { id: string; name: string; hasAccount: boolean }

const ROLE_KEY: Record<Role, string> = {
  crosshub: 'role.crosshub',
  affiliate: 'role.affiliate',
  partner: 'role.partner',
}

const STATUS_KEY = { active: 'accounts.statusActive', pending: 'accounts.statusPending', inactive: 'accounts.statusInactive' } as const

export function AccountsView({
  accounts,
  total,
  filter,
  pageSize,
  affiliates,
  partners,
  tab,
  children,
}: {
  accounts: AccountRow[]
  total: number
  filter: AccountFilter
  pageSize: number
  affiliates: Org[]
  partners: Org[]
  tab: AccountTab
  /** 계정 조회 말고 다른 탭이면 그 탭 내용. 제목·계정 발급 버튼·탭은 모든 탭이 같이 쓴다 */
  children?: React.ReactNode
}) {
  const t = useTranslations()
  const router = useRouter()
  const locale = useLocale()
  const { loginId: myLoginId } = useSession()
  // 모달을 열 때마다 key를 바꿔 입력값·결과를 초기화한다
  const [issueKey, setIssueKey] = useState<number | null>(null)
  const [resetResult, setResetResult] = useState<{ loginId: string; tempPassword: string } | null>(null)
  const [resetError, setResetError] = useState<ErrorKey | null>(null)
  const [resetting, startReset] = useTransition()
  const [toggleError, setToggleError] = useState<ErrorKey | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggling, startToggle] = useTransition()

  function handleReset(account: AccountRow) {
    if (!window.confirm(`${account.loginId}\n${t('accounts.resetConfirm')}`)) return
    setResetError(null)
    startReset(async () => {
      const result = await resetPassword(account.id)
      if (result.error) setResetError(result.error)
      else if (result.loginId && result.tempPassword) setResetResult({ loginId: result.loginId, tempPassword: result.tempPassword })
    })
  }

  function handleToggle(account: AccountRow) {
    // 비활성화는 로그인을 막는 조치라 확인을 받는다. 다시 활성화하는 쪽은 위험하지 않아 바로 처리.
    if (account.active && !window.confirm(`${account.loginId}\n${t('accounts.deactivateConfirm')}`)) return
    setToggleError(null)
    setTogglingId(account.id)
    startToggle(async () => {
      const result = await toggleActive(account.id)
      if (result.error) setToggleError(result.error)
      setTogglingId(null)
    })
  }

  const formatDate = (iso: string) =>
    formatJstDate(iso, locale)
  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)

  // 지금 검색 조건 (페이지 번호를 바꿀 때 그대로 넘긴다)
  const query: Record<string, string> = {}
  if (filter.role) query.role = filter.role
  if (filter.orgId) query.org = filter.orgId
  if (filter.status) query.status = filter.status
  if (filter.keyword) query.q = filter.keyword

  // 검색하면 1페이지부터 다시 본다
  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const next: Record<string, string> = {}
    for (const key of ['role', 'org', 'status', 'q']) {
      const value = String(form.get(key) ?? '').trim()
      if (value) next[key] = value
    }
    router.push({ pathname: '/accounts', query: next })
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNTS</p>
          <h1>{t('accounts.title')}</h1>
        </div>
        <button className="primary-button" onClick={() => setIssueKey(Date.now())}>
          <Plus size={18} /> {t('accounts.issue')}
        </button>
      </section>

      <PageTabs
        active={tab}
        tabs={ACCOUNT_TABS.map((key) => ({
          key,
          label: t(`accounts.tab.${key}`),
          href: key === 'list' ? '/accounts' : { pathname: '/accounts', query: { tab: key } },
        }))}
      />

      {resetError && <p style={{ color: '#c45b4d', fontSize: 12 }}>{t(`errors.${resetError}`)}</p>}
      {toggleError && <p style={{ color: '#c45b4d', fontSize: 12 }}>{t(`errors.${toggleError}`)}</p>}

      {children ?? (
        <div className="card products-card">
          {/* key: 초기화·뒤로가기로 조건이 바뀌면 입력칸도 새 조건으로 다시 채운다 */}
          <form key={JSON.stringify(query)} className="filter-bar" onSubmit={handleSearch}>
            <select name="role" defaultValue={filter.role ?? ''} aria-label={t('accounts.colRole')}>
              <option value="">{t('accounts.allRoles')}</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(ROLE_KEY[r])}
                </option>
              ))}
            </select>
            <select name="org" defaultValue={filter.orgId ?? ''} aria-label={t('accounts.colOrg')}>
              <option value="">{t('accounts.allOrgs')}</option>
              {[...affiliates, ...partners].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
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
            <Link href="/accounts" className="outline-button">
              {t('common.reset')}
            </Link>
            <span className="total">{t('common.totalCount', { count: total })}</span>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('login.id')}</th>
                  <th>{t('accounts.colName')}</th>
                  <th>{t('accounts.colRole')}</th>
                  <th>{t('accounts.colCreated')}</th>
                  <th>{t('accounts.colLastLogin')}</th>
                  <th>{t('accounts.colStatus')}</th>
                  <th>
                    <span className="sr-only">{t('accounts.resetPw')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={7}>{t('accounts.empty')}</td>
                  </tr>
                )}
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.loginId}</strong>
                    </td>
                    <td>{a.name}</td>
                    <td>{t(ROLE_KEY[a.role])}</td>
                    <td>{formatDate(a.createdAt)}</td>
                    <td className="muted">
                      {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : '-'}
                      {a.lastLoginIp && (
                        <div style={{ fontSize: 10, marginTop: 3 }}>
                          {a.lastLoginIp} · {describeUserAgent(a.lastLoginUserAgent)}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`status ${!a.active ? 'status-hidden' : a.pending ? 'status-review' : 'status-live'}`}>
                        <i />
                        {t(!a.active ? 'accounts.statusInactive' : a.pending ? 'accounts.statusPending' : 'accounts.statusActive')}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {/* 내 계정은 비밀번호 변경 메뉴에서 바꾸고, 여기서 활성화를 끌 수도 없다 */}
                      {a.loginId !== myLoginId && (
                        <>
                          {/* 크로스허브 계정은 app 백오피스와 같은 Keycloak 계정이라 여기서 비번을 초기화하지 않는다 (BE 도 403) */}
                          {a.role !== 'crosshub' && (
                            <button className="outline-button" disabled={resetting} onClick={() => handleReset(a)}>
                              <KeyRound size={14} /> {t('accounts.resetPw')}
                            </button>
                          )}
                          <button className="outline-button" disabled={toggling && togglingId === a.id} onClick={() => handleToggle(a)}>
                            {a.active ? (
                              <>
                                <Ban size={14} /> {t('accounts.deactivate')}
                              </>
                            ) : (
                              <>
                                <Check size={14} /> {t('accounts.activate')}
                              </>
                            )}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pathname="/accounts" query={query} page={filter.page} total={total} pageSize={pageSize} />
        </div>
      )}

      {issueKey !== null && (
        <IssueModal key={issueKey} affiliates={affiliates} partners={partners} onClose={() => setIssueKey(null)} />
      )}

      {resetResult && (
        <Modal eyebrow="PASSWORD" title={t('accounts.resetPw')} onClose={() => setResetResult(null)}>
          <TempPasswordBox
            title={t('accounts.resetTitle')}
            loginId={resetResult.loginId}
            tempPassword={resetResult.tempPassword}
           
            onDone={() => setResetResult(null)}
          />
        </Modal>
      )}
    </>
  )
}

function IssueModal({
  affiliates,
  partners,
  onClose,
}: {
  affiliates: Org[]
  partners: Org[]
  onClose: () => void
}) {
  const t = useTranslations()
  const [state, action, pending] = useActionState<IssueState, FormData>(issueAccount, {})
  // 역할에 따라 소속 칸을 바꿔 보여주기 위한 값. select 자체는 비제어(defaultValue)로 둔다:
  // 제출이 끝나면 React가 폼을 초기화하는데, 제어형 select는 첫 옵션(크로스허브)으로 돌아가 버린다
  const [role, setRole] = useState<Role>('partner')
  const v = state.values
  // 소속 연맹에서 '새 연맹 추가'를 고르면 연맹명 칸을 연다 (select는 위와 같은 이유로 비제어)
  const [newAffiliate, setNewAffiliate] = useState(v?.affiliateId === NEW_AFFILIATE)
  // 오류로 돌아오면 폼을 새로 그려 보낸 값(defaultValue)으로 다시 채운다. 그대로 두면 React가 select를 처음 값(업체)으로 되돌린다
  const formKey = v ? JSON.stringify(v) : 'new'
  useEffect(() => {
    if (!v) return
    setRole(v.role as Role)
    setNewAffiliate(v.affiliateId === NEW_AFFILIATE)
  }, [v])

  return (
    <Modal eyebrow="NEW ACCOUNT" title={t('accounts.issue')} onClose={onClose}>
      {state.issued ? (
        <TempPasswordBox
          title={t('accounts.issuedTitle')}
          loginId={state.issued.loginId}
          tempPassword={state.issued.tempPassword}
         
          onDone={onClose}
        />
      ) : (
        <form key={formKey} action={action}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
            <label className="modal-label">
              {t('accounts.colRole')}
              <select name="role" defaultValue={v?.role ?? 'partner'} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_KEY[r])}
                  </option>
                ))}
              </select>
            </label>

            {role === 'affiliate' && (
              <label className="modal-label">
                {t('accounts.fieldAffiliate')}
                <select name="affiliateId" defaultValue={v?.affiliateId ?? ''} required onChange={(e) => setNewAffiliate(e.target.value === NEW_AFFILIATE)}>
                  <option value="">{t('accounts.select')}</option>
                  {affiliates.filter((o) => !o.hasAccount).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                  <option value={NEW_AFFILIATE}>{t('accounts.newAffiliate')}</option>
                </select>
              </label>
            )}

            {role === 'affiliate' && newAffiliate && (
              <label className="modal-label">
                {t('accounts.fieldAffiliateName')}
                <input name="newAffiliateName" defaultValue={v?.newAffiliateName} maxLength={50} required />
              </label>
            )}

            {role === 'partner' && (
              <label className="modal-label">
                {t('accounts.fieldPartner')}
                <select name="partnerId" defaultValue={v?.partnerId ?? ''} required>
                  <option value="">{t('accounts.select')}</option>
                  {partners.filter((o) => !o.hasAccount).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <small style={{ color: '#6b6e69', fontWeight: 400 }}>{t('accounts.partnerHint')}</small>
              </label>
            )}

            {/* 연맹·업체 계정은 소속당 1개라 이름 대신 소속명을 쓴다. 크로스허브 계정만 담당자 이름을 받는다 */}
            {role === 'crosshub' && (
              <label className="modal-label">
                {t('accounts.colName')}
                <input name="name" defaultValue={v?.name} maxLength={50} required />
              </label>
            )}
            <label className="modal-label">
              {t('login.id')}
              <input name="loginId" defaultValue={v?.loginId} pattern="[a-z0-9._\-]{4,30}" autoComplete="off" required />
              <small style={{ color: '#6b6e69', fontWeight: 400 }}>{t('accounts.loginIdHint')}</small>
            </label>
          </div>

          {state.error && <p style={{ color: '#c45b4d', fontSize: 12, margin: '12px 0 0' }}>{t(`errors.${state.error}`)}</p>}

          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary-button" disabled={pending}>
              {pending ? t('common.processing') : t('accounts.issue')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function Modal({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const t = useTranslations()
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-top">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function TempPasswordBox({
  title,
  loginId,
  tempPassword,
  onDone,
}: {
  title: string
  loginId: string
  tempPassword: string
  onDone: () => void
}) {
  const t = useTranslations()
  return (
    <div className="credential-box">
      <Check size={30} style={{ color: '#5b9977' }} />
      <h3>{title}</h3>
      <p>{t('accounts.tempDesc')}</p>
      <div className="credential-box" style={{ textAlign: 'left', margin: '18px 0' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <KeyRound size={13} /> {t('accounts.tempPassword')}
        </span>
        <strong style={{ fontSize: 15 }}>ID: {loginId}</strong>
        <small style={{ userSelect: 'all' }}>PW: {tempPassword}</small>
      </div>
      <button className="primary-button full" onClick={onDone}>
        {t('common.confirm')}
      </button>
    </div>
  )
}

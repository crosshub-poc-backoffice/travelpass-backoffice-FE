'use client'

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { FileText, Plus, Search, Store, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import {
  createPartnerAction,
  togglePartnerActiveAction,
  updatePartnerAction,
  type PartnerFormState,
  type PartnerFormValues,
} from './actions'
import type { ErrorKey } from '@/lib/errors'
import { PARTNER_MEMO_MAX, PARTNER_NAME_MAX, PARTNER_TEXT_MAX, PENDING_FIELDS } from '@/lib/partner-fields'
import { useSession } from '@/lib/role-context'
import { PageTabs } from '@/components/page-tabs'
import type { PartnerRow } from '@/lib/server/partners/service'
import { formatJstDate } from '@/lib/datetime'

type Org = { id: string; name: string }

export function PartnersView({
  partners,
  affiliates,
  currencies = [],
  initialPartnerId = null,
  tab = 'list',
  showHistoryTab = false,
  children,
}: {
  partners: PartnerRow[]
  affiliates: Org[]
  /** 통화 선택지 (lib/money SUPPORTED_CURRENCIES). 크로스허브만 받는다 */
  currencies?: string[]
  initialPartnerId?: string | null
  tab?: 'list' | 'history'
  /** 작업 이력 탭을 보일지 (page.tsx의 PARTNER_HISTORY_TAB). 끄면 탭 줄 자체를 숨긴다 */
  showHistoryTab?: boolean
  /** 업체 목록 말고 다른 탭이면 그 탭 내용. 제목·업체 등록 버튼·탭은 같이 쓴다 */
  children?: React.ReactNode
}) {
  const t = useTranslations()
  const locale = useLocale()
  const { role } = useSession()
  const [keyword, setKeyword] = useState('')
  // 모달을 열 때마다 key를 바꿔 입력값·결과를 초기화한다. partner가 null이면 등록
  const [form, setForm] = useState<{ key: number; partner: PartnerRow | null } | null>(null)
  const [toggleError, setToggleError] = useState<ErrorKey | null>(null)
  const [toggling, startToggle] = useTransition()
  // 비활성화로 숨긴 상품이 있는 업체를 다시 활성화할 때만 여는 확인창 (상품을 되돌릴지 고른다)
  const [activating, setActivating] = useState<PartnerRow | null>(null)

  useEffect(() => {
    if (!initialPartnerId) return
    const match = partners.find((p) => p.id === initialPartnerId)
    if (match) setForm({ key: Date.now(), partner: match })
  }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return partners
    return partners.filter((p) => [p.name, p.managerName, p.email].some((s) => s?.toLowerCase().includes(k)))
  }, [partners, keyword])

  const formatDate = (iso: string) =>
    formatJstDate(iso, locale)

  // 업체 계정은 목록 대신 자기 업체 정보 화면 ("내 업체 정보")
  if (role === 'partner') return <MyPartnerView partner={partners[0] ?? null} />

  function runToggle(p: PartnerRow, restoreProducts = false) {
    setToggleError(null)
    startToggle(async () => {
      const result = await togglePartnerActiveAction(p.id, restoreProducts)
      if (result.error) setToggleError(result.error)
    })
  }

  function handleToggle(p: PartnerRow) {
    if (!p.active && p.hiddenByOffCount > 0) return setActivating(p)
    if (!window.confirm(`${p.name}\n${t(p.active ? 'partners.deactivateConfirm' : 'partners.activateConfirm')}`)) return
    runToggle(p)
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">PARTNERS</p>
          <h1>{t('page.partners.title')}</h1>
        </div>
        <button className="primary-button" onClick={() => setForm({ key: Date.now(), partner: null })}>
          <Plus size={18} /> {t('partners.create')}
        </button>
      </section>

      {showHistoryTab && (
        <PageTabs
          active={tab}
          tabs={[
            { key: 'list', label: t('partners.tab.list'), href: '/partners' },
            { key: 'history', label: t('partners.tab.history'), href: { pathname: '/partners', query: { tab: 'history' } } },
          ]}
        />
      )}

      {children ?? (
        <>
          {toggleError && <p style={{ color: '#c45b4d', fontSize: 12 }}>{t(`errors.${toggleError}`)}</p>}

          <div className="card products-card">
            <div className="toolbar">
              <div className="search-box">
                <Search size={17} />
                <input placeholder={t('partners.search')} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('partners.colName')}</th>
                    <th>{t('partners.colOperation')}</th>
                    <th>{t('partners.colManager')}</th>
                    <th>{t('partners.colCreated')}</th>
                    <th>{t('partners.colStatus')}</th>
                    {role === 'crosshub' && (
                      <th>
                        <span className="sr-only">{t('partners.colStatus')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6}>{t(partners.length === 0 ? 'partners.empty' : 'partners.noResult')}</td>
                    </tr>
                  )}
                  {filtered.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <button className="table-link product-cell" onClick={() => setForm({ key: Date.now(), partner: p })}>
                          <div className="product-thumb product-teal">
                            <Store size={18} />
                          </div>
                          <div>
                            <strong>{p.name}</strong>
                            {p.email && <span>{p.email}</span>}
                          </div>
                        </button>
                      </td>
                      <td>
                        <span className={`status ${p.proxyAffiliateId ? 'status-review' : 'status-live'}`}>
                          <i />
                          {p.proxyAffiliateId ? t('partners.proxy', { name: p.proxyAffiliateName ?? '' }) : t('partners.direct')}
                        </span>
                      </td>
                      <td>{p.managerName ?? '-'}</td>
                      <td className="muted">{formatDate(p.createdAt)}</td>
                      <td>
                        {p.active === null ? (
                          '-'
                        ) : (
                          <span className={`status ${p.active ? 'status-live' : 'status-hidden'}`}>
                            <i />
                            {t(p.active ? 'partners.active' : 'partners.inactive')}
                          </span>
                        )}
                      </td>
                      {role === 'crosshub' && (
                        <td>
                          <button
                            className="outline-button"
                            disabled={toggling || PENDING_FIELDS.has('active')}
                            title={PENDING_FIELDS.has('active') ? t('partners.pendingNote') : undefined}
                            onClick={() => handleToggle(p)}
                          >
                            {t(p.active === false ? 'partners.activate' : 'partners.deactivate')}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}

      {form && <PartnerFormModal key={form.key} partner={form.partner} affiliates={affiliates} currencies={currencies} onClose={() => setForm(null)} />}
      {activating && (
        <ActivateModal
          partner={activating}
          onConfirm={(restore) => {
            setActivating(null)
            runToggle(activating, restore)
          }}
          onClose={() => setActivating(null)}
        />
      )}
    </>
  )
}

function ActivateModal({
  partner,
  onConfirm,
  onClose,
}: {
  partner: PartnerRow
  onConfirm: (restoreProducts: boolean) => void
  onClose: () => void
}) {
  const t = useTranslations()
  const [restore, setRestore] = useState(true)
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
        <div className="modal-top">
          <div>
            <p className="eyebrow">PARTNER</p>
            <h2>{partner.name}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={19} />
          </button>
        </div>
        <p style={{ margin: '0 0 14px' }}>{t('partners.activateConfirm')}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} style={{ width: 14, height: 14 }} />
          {t('partners.restoreProducts', { count: partner.hiddenByOffCount })}
        </label>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary-button" onClick={() => onConfirm(restore)}>
            {t('partners.activate')}
          </button>
        </div>
      </div>
    </div>
  )
}

// 업체 계정용 "내 업체 정보". 기본정보·담당자만 고치고, 운영방식·수수료율은 보기만 (메뉴권한표)
function MyPartnerView({ partner }: { partner: PartnerRow | null }) {
  const t = useTranslations()
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const handleSaved = useCallback(() => setSavedAt(Date.now()), [])

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">MY PARTNER</p>
          <h1>{t('nav.myPartner')}</h1>
        </div>
      </section>
      <div className="card products-card" style={{ maxWidth: 640 }}>
        {partner ? (
          <>
            {savedAt && <p className="partner-saved">{t('partners.saved')}</p>}
            {/* 저장 후 서버에서 새 값이 오면 key를 바꿔 입력칸을 새 값으로 다시 채운다 */}
            <PartnerForm key={partner.name + (savedAt ?? '')} partner={partner} affiliates={[]} onSaved={handleSaved} />
          </>
        ) : (
          <p className="muted">{t('partners.empty')}</p>
        )}
      </div>
    </>
  )
}

function PartnerFormModal({
  partner,
  affiliates,
  currencies,
  onClose,
}: {
  partner: PartnerRow | null
  affiliates: Org[]
  currencies: string[]
  onClose: () => void
}) {
  const t = useTranslations()
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <div className="modal-top">
          <div>
            <p className="eyebrow">{partner ? 'PARTNER' : 'NEW PARTNER'}</p>
            <h2>{partner ? partner.name : t('partners.create')}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={19} />
          </button>
        </div>
        <PartnerForm partner={partner} affiliates={affiliates} currencies={currencies} onSaved={onClose} onCancel={onClose} />
      </div>
    </div>
  )
}

function PartnerForm({
  partner,
  affiliates,
  currencies = [],
  onSaved,
  onCancel,
}: {
  partner: PartnerRow | null
  affiliates: Org[]
  currencies?: string[]
  onSaved: () => void
  /** 없으면 취소 버튼을 숨긴다 (내 업체 정보 화면) */
  onCancel?: () => void
}) {
  const t = useTranslations()
  const { role, orgName } = useSession()
  const [state, action, pending] = useActionState<PartnerFormState, FormData>(
    partner ? updatePartnerAction : createPartnerAction,
    {},
  )

  useEffect(() => {
    if (state.saved) onSaved()
  }, [state.saved, onSaved])

  // 오류로 돌아오면 보낸 값, 아니면 지금 값으로 채운다
  const v: Partial<PartnerFormValues> = state.values ?? {
    name: partner?.name,
    proxyAffiliateId: partner?.proxyAffiliateId ?? '',
    currency: partner?.currency ?? currencies[0] ?? 'JPY',
    managerName: partner?.managerName ?? undefined,
    phone: partner?.phone ?? undefined,
    email: partner?.email ?? undefined,
    memo: partner?.memo ?? undefined,
    businessRegistrationNumber: partner?.businessRegistrationNumber ?? undefined,
    representativeName: partner?.representativeName ?? undefined,
    corporateName: partner?.corporateName ?? undefined,
    address: partner?.address ?? undefined,
    businessLicenseUrl: partner?.businessLicenseUrl ?? undefined,
    subManager: partner?.subManager ?? undefined,
    subManagerPhone: partner?.subManagerPhone ?? undefined,
  }
  const pendingProps = (field: keyof PartnerFormValues) => ({ name: field, disabled: PENDING_FIELDS.has(field) })

  // 연맹은 운영방식을 못 바꾼다 (자기 대행 업체로만 등록)
  const operationText = partner
    ? partner.proxyAffiliateId
      ? t('partners.proxy', { name: partner.proxyAffiliateName ?? '' })
      : t('partners.direct')
    : t('partners.proxy', { name: orgName ?? '' })

  return (
    <>
      {PENDING_FIELDS.size > 0 && <p className="partner-pending-note">{t('partners.pendingNote')}</p>}

      <form action={action}>
        {partner && <input type="hidden" name="id" value={partner.id} />}

        <div className="partner-form">
          <h3>{t('partners.sectionBasic')}</h3>
          <label className="modal-label">
            {t('partners.fieldName')}
            <input name="name" defaultValue={v.name} maxLength={PARTNER_NAME_MAX} required />
          </label>

          <label className="modal-label">
            {t('partners.fieldOperation')}
            {role === 'crosshub' ? (
              // select는 defaultValue가 바뀌어도 폼 초기화 때 처음 값으로 돌아가므로, 값이 바뀌면 key로 새로 만든다
              <select key={v.proxyAffiliateId ?? ''} name="proxyAffiliateId" defaultValue={v.proxyAffiliateId ?? ''}>
                <option value="">{t('partners.direct')}</option>
                {affiliates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t('partners.proxy', { name: a.name })}
                  </option>
                ))}
              </select>
            ) : (
              <strong className="partner-readonly">{operationText}</strong>
            )}
            {role !== 'partner' && <small>{t('partners.operationHint')}</small>}
          </label>

          <label className="modal-label">
            {t('partners.fieldCurrency')}
            {role === 'crosshub' ? (
              <select key={v.currency ?? ''} name="currency" defaultValue={v.currency ?? ''}>
                {/* 지금 값이 설정 목록에 없더라도(설정이 지워진 경우) 그대로 고를 수 있게 둔다 */}
                {[...new Set([...(v.currency ? [v.currency] : []), ...currencies])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <strong className="partner-readonly">{partner?.currency ?? '-'}</strong>
            )}
            {role === 'crosshub' && <small>{t('partners.currencyHint')}</small>}
          </label>

          <h3>{t('partners.sectionBusiness')}</h3>
          <label className="modal-label">
            {t('partners.fieldCorporateName')}
            <input defaultValue={v.corporateName} maxLength={PARTNER_TEXT_MAX} {...pendingProps('corporateName')} />
          </label>
          <label className="modal-label">
            {t('partners.fieldRepresentative')}
            <input defaultValue={v.representativeName} maxLength={PARTNER_TEXT_MAX} {...pendingProps('representativeName')} />
          </label>
          <label className="modal-label">
            {t('partners.fieldBusinessNumber')}
            <input defaultValue={v.businessRegistrationNumber} maxLength={PARTNER_TEXT_MAX} {...pendingProps('businessRegistrationNumber')} />
          </label>
          <label className="modal-label">
            {t('partners.fieldAddress')}
            <input defaultValue={v.address} maxLength={PARTNER_MEMO_MAX} {...pendingProps('address')} />
          </label>
          <LicenseField key={v.businessLicenseUrl ?? ''} defaultUrl={v.businessLicenseUrl ?? ''} />
          <h3>{t('partners.sectionManager')}</h3>
          <label className="modal-label">
            {t('partners.fieldManagerName')}
            <input defaultValue={v.managerName} maxLength={PARTNER_TEXT_MAX} {...pendingProps('managerName')} />
          </label>
          <label className="modal-label">
            {t('partners.fieldPhone')}
            <input type="tel" defaultValue={v.phone} maxLength={PARTNER_TEXT_MAX} {...pendingProps('phone')} />
          </label>
          <label className="modal-label">
            {t('partners.fieldEmail')}
            <input type="email" defaultValue={v.email} maxLength={PARTNER_TEXT_MAX} {...pendingProps('email')} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="modal-label">
              {t('partners.fieldSubManager')}
              <input defaultValue={v.subManager} maxLength={PARTNER_TEXT_MAX} {...pendingProps('subManager')} />
            </label>
            <label className="modal-label">
              {t('partners.fieldSubManagerPhone')}
              <input type="tel" defaultValue={v.subManagerPhone} maxLength={PARTNER_TEXT_MAX} {...pendingProps('subManagerPhone')} />
            </label>
          </div>

          {/* 내부 메모는 크로스허브·연맹만 본다 */}
          {role !== 'partner' && (
            <>
              <h3>{t('partners.fieldMemo')}</h3>
              <label className="modal-label">
                <textarea defaultValue={v.memo} maxLength={PARTNER_MEMO_MAX} aria-label={t('partners.fieldMemo')} {...pendingProps('memo')} />
                <small>{t('partners.memoHint')}</small>
              </label>
            </>
          )}
        </div>

        {state.error && <p style={{ color: '#c45b4d', fontSize: 12, margin: '12px 0 0' }}>{t(`errors.${state.error}`)}</p>}

        <div className="modal-actions">
          {onCancel && (
            <button type="button" className="outline-button" onClick={onCancel}>
              {t('common.cancel')}
            </button>
          )}
          <button type="submit" className="primary-button" disabled={pending}>
            {pending ? t('common.processing') : t('common.save')}
          </button>
        </div>
      </form>
    </>
  )
}

// 사업자등록증. 파일을 고르면 바로 올리고, 받은 URL을 숨은 칸(businessLicenseUrl)에 넣어 업체 저장 때 같이 보낸다
function LicenseField({ defaultUrl }: { defaultUrl: string }) {
  const t = useTranslations()
  const [url, setUrl] = useState(defaultUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(false)

  async function upload(file: File) {
    setUploading(true)
    setError(false)
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/partners/license', { method: 'POST', body }).catch(() => null)
    const data = res?.ok ? ((await res.json()) as { url: string }) : null
    if (data) setUrl(data.url)
    else setError(true)
    setUploading(false)
  }

  return (
    <div className="modal-label">
      {t('partners.fieldLicense')}
      <input type="hidden" name="businessLicenseUrl" value={url} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="outline-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} /> {t('partners.licenseView')}
          </a>
        )}
        <label className="outline-button" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? t('common.processing') : t(url ? 'partners.licenseReplace' : 'partners.licenseUpload')}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) upload(file)
            }}
          />
        </label>
        {url && (
          <button type="button" className="outline-button" onClick={() => setUrl('')}>
            {t('common.delete')}
          </button>
        )}
      </div>
      <small style={error ? { color: '#c45b4d' } : undefined}>{t(error ? 'errors.licenseFile' : 'partners.licenseHint')}</small>
    </div>
  )
}

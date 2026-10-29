'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRole } from '@/lib/role-context'
import { LOCALE_LABELS, type Locale } from '@/i18n/routing'
import { Link, usePathname, useRouter } from '@/i18n/navigation'

export default function SettingsPage() {
  const { role } = useRole()
  const t = useTranslations()
  const ts = useTranslations('settings')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [notifyInquiry, setNotifyInquiry] = useState(true)

  function handleLocaleChange(next: Locale) {
    router.replace(pathname, { locale: next })
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>{t('page.settings.title')}</h1>
        </div>
      </section>

      <div className="detail-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card form-card">
            <h2>{ts('languageTitle')}</h2>
            <label className="modal-label">
              {ts('adminLanguage')}
              <select value={locale} onChange={(e) => handleLocaleChange(e.target.value as Locale)}>
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="card form-card">
            <h2>{ts('notificationTitle')}</h2>
            <div className="toggle-row">
              <span>{ts('newInquiryNotify')}</span>
              <button className={`status ${notifyInquiry ? 'status-live' : 'status-hidden'}`} onClick={() => setNotifyInquiry((v) => !v)}>
                <i />
                {notifyInquiry ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>

        <div className="card info-card">
          <h2>{ts('accountInfoTitle')}</h2>
          <div className="info-list">
            <div>
              <span>{ts('roleLabel')}</span>
              <strong>{t(`role.long.${role}`)}</strong>
            </div>
            <div>
              <span>{ts('scopeLabel')}</span>
              <strong>{t(`role.desc.${role}`)}</strong>
            </div>
          </div>
          <Link href="/change-password" className="outline-button full" style={{ justifyContent: 'center' }}>
            {t('nav.changePassword')}
          </Link>
        </div>
      </div>
    </>
  )
}

'use client'

import { useState } from 'react'
import { Globe } from 'lucide-react'
import type { ErrorKey } from '@/lib/errors'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { LOCALE_LABELS, type Locale } from '@/i18n/routing'

// 로그인은 Keycloak(crosshub realm)으로만 한다. 앱 DB 비밀번호 로그인은 껐다.
// 버튼은 Authorization Code + PKCE 시작점(Route Handler)으로 이동만 한다 — 아이디·비밀번호 입력은 Keycloak 화면에서.
export function LoginForm({ initialError }: { initialError?: ErrorKey }) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [showForgot, setShowForgot] = useState(false)

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/travelpass-wordmark.svg" alt="Travel Pass" className="brand-wordmark" />
          <span>PARTNER CENTER</span>
        </div>

        <h1>{t('login.title')}</h1>
        <p className="heading-sub" style={{ margin: '0 0 20px' }}>
          {t('login.subtitle')}
        </p>

        {initialError && <p style={{ color: '#c45b4d', fontSize: 11, margin: '0 0 12px' }}>{t(`errors.${initialError}`)}</p>}

        <a href="/api/auth/keycloak/login" className="primary-button full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          {t('common.login')}
        </a>

        <div className="login-options" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            style={{ border: 0, background: 'transparent', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
          >
            {t('login.forgot')}
          </button>
        </div>
        {showForgot && <p style={{ fontSize: 12, color: '#6b6e69', margin: '0 0 12px' }}>{t('login.forgotHelp')}</p>}

        {/* "Language"는 일부러 번역하지 않는다 — 로그인 전이라 화면 언어를 못 읽는 사람도 여기가 언어 바꾸는 곳인 줄 알아야 한다 */}
        <div className="auth-language">
          <Globe size={16} aria-hidden />
          <span>Language</span>
          <select aria-label="Language" value={locale} onChange={(e) => router.replace(pathname, { locale: e.target.value as Locale })}>
            {(Object.keys(LOCALE_LABELS) as Locale[]).map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useActionState, useState } from 'react'
import { Eye, EyeOff, Globe } from 'lucide-react'
import { login, type FormState } from '@/app/actions/auth'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { LOCALE_LABELS, type Locale } from '@/i18n/routing'

export function LoginForm() {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [state, action, pending] = useActionState<FormState, FormData>(login, {})
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/travelpass-wordmark.svg" alt="Travel Pass" className="brand-wordmark" />
          <span>PARTNER CENTER</span>
        </div>

        <form action={action}>
          <h1>{t('login.title')}</h1>
          <p className="heading-sub" style={{ margin: '0 0 20px' }}>
            {t('login.subtitle')}
          </p>

          <label className="modal-label">
            {t('login.id')}
            <input name="loginId" defaultValue={state.loginId} autoComplete="username" placeholder={t('login.idPlaceholder')} required />
          </label>
          <label className="modal-label">
            {t('login.password')}
            <div style={{ position: 'relative' }}>
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={t('login.password')}
                style={{ width: '100%', paddingRight: 36 }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: 8, top: 10, border: 0, background: 'transparent', color: '#9a9c97' }}
                aria-label={t('login.showPassword')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {state.error && <p style={{ color: '#c45b4d', fontSize: 11, margin: '10px 0 0' }}>{t(`errors.${state.error}`)}</p>}

          <div className="login-options">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input name="remember" type="checkbox" defaultChecked={state.remember} style={{ width: 14, height: 14 }} />
              {t('login.remember')}
            </label>
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              style={{ border: 0, background: 'transparent', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {t('login.forgot')}
            </button>
          </div>
          {showForgot && <p style={{ fontSize: 12, color: '#6b6e69', margin: '0 0 12px' }}>{t('login.forgotHelp')}</p>}

          <button type="submit" className="primary-button full" disabled={pending}>
            {pending ? t('common.processing') : t('common.login')}
          </button>
        </form>

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

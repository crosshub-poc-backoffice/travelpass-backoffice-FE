'use client'

import { Link } from '@/i18n/navigation'
import { useActionState } from 'react'
import { KeyRound } from 'lucide-react'
import { changePassword, logout, type FormState } from '@/app/actions/auth'
import { useTranslations } from 'next-intl'

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const t = useTranslations()
  const [state, action, pending] = useActionState<FormState, FormData>(changePassword, {})

  return (
    <div className="auth-page">
      <div className="auth-card">
        <form action={action}>
          {forced ? (
            <div className="credential-box" style={{ paddingTop: 0 }}>
              <KeyRound size={30} style={{ color: '#e4713e' }} />
              <h3>{t('password.firstTitle')}</h3>
              <p>{t('password.firstDesc')}</p>
            </div>
          ) : (
            <h1 style={{ fontSize: 20 }}>{t('password.title')}</h1>
          )}

          <label className="modal-label">
            {t('password.current')}
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label className="modal-label">
            {t('password.new')}
            <input name="next" type="password" autoComplete="new-password" placeholder={t('password.newPlaceholder')} minLength={8} required />
          </label>
          <label className="modal-label">
            {t('password.confirm')}
            <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
          </label>

          {state.error && <p style={{ color: '#c45b4d', fontSize: 11, margin: '10px 0 0' }}>{t(`errors.${state.error}`)}</p>}

          <button type="submit" className="primary-button full" style={{ marginTop: 16 }} disabled={pending}>
            {pending ? t('common.processing') : t('password.submit')}
          </button>
        </form>

        {/* 최초 로그인 때는 바꾸기 전까지 다른 화면으로 못 가므로 로그아웃만 둔다 */}
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12 }}>
          {forced ? (
            <form action={logout}>
              <button type="submit" style={{ border: 0, background: 'transparent', color: '#6b6e69', textDecoration: 'underline', cursor: 'pointer' }}>
                {t('common.logout')}
              </button>
            </form>
          ) : (
            <Link href="/dashboard" style={{ color: '#6b6e69' }}>
              {t('password.back')}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

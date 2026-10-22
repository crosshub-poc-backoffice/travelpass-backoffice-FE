'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { PARTNER_TEXT_MAX } from '@/lib/partner-fields'
import type { MyAffiliate } from '@/lib/server/payments/service'
import { saveMyAffiliateBankAction, type MyAffiliateFormState } from './actions'

export function MyAffiliateView({ affiliate }: { affiliate: MyAffiliate | null }) {
  const t = useTranslations()
  const [state, action, pending] = useActionState<MyAffiliateFormState, FormData>(saveMyAffiliateBankAction, {})

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">MY FEDERATION</p>
          <h1>{t('nav.myAffiliate')}</h1>
        </div>
      </section>
      <div className="card products-card" style={{ maxWidth: 640 }}>
        {affiliate ? (
          <form action={action}>
            {state.saved && <p className="partner-saved">{t('partners.saved')}</p>}
            <div className="partner-form">
              <h3>{t('partners.sectionBasic')}</h3>
              <label className="modal-label">
                {t('myAffiliate.fieldName')}
                <strong className="partner-readonly">{affiliate.name}</strong>
              </label>
              <label className="modal-label">
                {t('settlements.settings.colShare')}
                <strong className="partner-readonly">{affiliate.shareRate == null ? '-' : `${affiliate.shareRate}%p`}</strong>
              </label>

              <h3>{t('partners.sectionBank')}</h3>
              <label className="modal-label">
                {t('partners.fieldBankName')}
                <input name="bankName" defaultValue={affiliate.bankName ?? ''} maxLength={PARTNER_TEXT_MAX} />
              </label>
              <label className="modal-label">
                {t('partners.fieldAccountNumber')}
                <input name="bankAccountNumber" defaultValue={affiliate.bankAccountNumber ?? ''} maxLength={PARTNER_TEXT_MAX} />
              </label>
              <label className="modal-label">
                {t('partners.fieldAccountHolder')}
                <input name="bankAccountHolder" defaultValue={affiliate.bankAccountHolder ?? ''} maxLength={PARTNER_TEXT_MAX} />
              </label>
            </div>

            {state.error && <p style={{ color: '#c45b4d', fontSize: 12, margin: '12px 0 0' }}>{t(`errors.${state.error}`)}</p>}

            <div className="modal-actions">
              <button type="submit" className="primary-button" disabled={pending}>
                {pending ? t('common.processing') : t('common.save')}
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">{t('partners.empty')}</p>
        )}
      </div>
    </>
  )
}

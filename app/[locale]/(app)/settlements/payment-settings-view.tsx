'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { ErrorKey } from '@/lib/errors'
import { PARTNER_TEXT_MAX } from '@/lib/partner-fields'
import { PAY_DAY_MAX, PG_NAME_MAX, SUPPORTED_CURRENCIES } from '@/lib/settlements'
import type { AffiliateShareRow, PgSettingRow } from '@/lib/server/payments/service'
import { saveAffiliateShareAction, savePgSettingAction, type PgSettingFormState } from './actions'

// 결제 설정 (크로스허브만). 통화별 PG 한 줄씩 + 연맹 몫. 숫자는 전부 여기서 바꾼다
export function PaymentSettingsView({ settings, shares }: { settings: PgSettingRow[]; shares: AffiliateShareRow[] }) {
  const t = useTranslations()
  // 모달을 열 때마다 key를 바꿔 입력값·결과를 초기화한다. setting이 null이면 통화 추가
  const [form, setForm] = useState<{ key: number; setting: PgSettingRow | null } | null>(null)

  return (
    <>
      <div className="card products-card" style={{ marginBottom: 16 }}>
        <div className="card-header products-header">
          <div>
            <h2>{t('settlements.settings.pgTitle')}</h2>
            <p>{t('settlements.settings.pgHint')}</p>
          </div>
          <button className="primary-button" style={{ whiteSpace: 'nowrap' }} onClick={() => setForm({ key: Date.now(), setting: null })}>
            <Plus size={16} /> {t('settlements.settings.addCurrency')}
          </button>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{t('settlements.colCurrency')}</th>
                <th>{t('settlements.settings.colPg')}</th>
                <th>{t('settlements.settings.colFeeRate')}</th>
                <th>{t('settlements.settings.colPayDay')}</th>
                <th>
                  <span className="sr-only">{t('common.edit')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.length === 0 && (
                <tr>
                  <td colSpan={5}>{t('settlements.settings.pgEmpty')}</td>
                </tr>
              )}
              {settings.map((s) => (
                <tr key={s.currency}>
                  <td>
                    <strong>{s.currency}</strong>
                  </td>
                  <td>{s.pgName}</td>
                  <td>{s.feeRate}%</td>
                  <td>{t('settlements.settings.payDayValue', { day: s.payDay })}</td>
                  <td>
                    <button className="outline-button" onClick={() => setForm({ key: Date.now(), setting: s })}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card products-card">
        <div className="card-header">
          <div>
            <h2>{t('settlements.settings.shareTitle')}</h2>
            <p>{t('settlements.settings.shareHint')}</p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{t('settlements.settings.colAffiliate')}</th>
                <th>{t('settlements.settings.colShare')}</th>
                <th>{t('partners.fieldBankName')}</th>
                <th>{t('partners.fieldAccountNumber')}</th>
                <th>{t('partners.fieldAccountHolder')}</th>
                <th>
                  <span className="sr-only">{t('common.save')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shares.length === 0 && (
                <tr>
                  <td colSpan={6}>{t('settlements.settings.affiliateEmpty')}</td>
                </tr>
              )}
              {shares.map((a) => (
                <ShareRow key={a.id} affiliate={a} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {form && <PgSettingModal key={form.key} setting={form.setting} usedCurrencies={settings.map((s) => s.currency)} onClose={() => setForm(null)} />}
    </>
  )
}

function ShareRow({ affiliate }: { affiliate: AffiliateShareRow }) {
  const t = useTranslations()
  const [value, setValue] = useState(affiliate.shareRate?.toString() ?? '')
  const [bank, setBank] = useState({
    bankName: affiliate.bankName ?? '',
    bankAccountNumber: affiliate.bankAccountNumber ?? '',
    bankAccountHolder: affiliate.bankAccountHolder ?? '',
  })
  const [error, setError] = useState<ErrorKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function save() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveAffiliateShareAction(affiliate.id, { shareRate: value, ...bank })
      if (result.error) setError(result.error)
      else setSaved(true)
    })
  }

  return (
    <tr>
      <td>
        <strong>{affiliate.name}</strong>
      </td>
      <td>
        <input type="number" min={0} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 90 }} aria-label={t('settlements.settings.colShare')} />
      </td>
      {/* 연맹 몫을 송금할 계좌. 월별 정산의 연맹 지급 표에 보인다 */}
      {(['bankName', 'bankAccountNumber', 'bankAccountHolder'] as const).map((key) => (
        <td key={key}>
          <input
            value={bank[key]}
            onChange={(e) => setBank((b) => ({ ...b, [key]: e.target.value }))}
            maxLength={PARTNER_TEXT_MAX}
            style={{ width: key === 'bankAccountNumber' ? 150 : 110 }}
            aria-label={t(key === 'bankName' ? 'partners.fieldBankName' : key === 'bankAccountNumber' ? 'partners.fieldAccountNumber' : 'partners.fieldAccountHolder')}
          />
        </td>
      ))}
      <td style={{ whiteSpace: 'nowrap' }}>
        {error && <span style={{ color: '#c45b4d', fontSize: 11, marginRight: 8 }}>{t(`errors.${error}`)}</span>}
        {saved && !error && <span style={{ color: '#57906e', fontSize: 11, marginRight: 8 }}>{t('settlements.settings.saved')}</span>}
        <button className="outline-button" disabled={pending} onClick={save}>
          {pending ? t('common.processing') : t('common.save')}
        </button>
      </td>
    </tr>
  )
}

function PgSettingModal({ setting, usedCurrencies, onClose }: { setting: PgSettingRow | null; usedCurrencies: string[]; onClose: () => void }) {
  const t = useTranslations()
  const locale = useLocale()
  const currencyNames = new Intl.DisplayNames([locale], { type: 'currency' })
  // 새로 추가할 때는 아직 설정 안 된 통화만 고른다 (통화당 PG 1개)
  const addable = SUPPORTED_CURRENCIES.filter((c) => !usedCurrencies.includes(c))
  const [state, action, pending] = useActionState<PgSettingFormState, FormData>(savePgSettingAction, {})

  useEffect(() => {
    if (state.saved) onClose()
  }, [state.saved, onClose])

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" style={{ maxWidth: 460 }}>
        <div className="modal-top">
          <div>
            <p className="eyebrow">PAYMENT SETTING</p>
            <h2>{setting ? setting.currency : t('settlements.settings.addCurrency')}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={19} />
          </button>
        </div>
        <form action={action}>
          <label className="modal-label">
            {t('settlements.settings.fieldCurrency')}
            {/* 통화는 키라서 수정할 때는 못 바꾼다 (바꾸려면 새 통화를 추가) */}
            {setting ? (
              <input name="currency" defaultValue={setting.currency} readOnly />
            ) : (
              <select name="currency" defaultValue={addable[0] ?? ''} required>
                {addable.map((c) => (
                  <option key={c} value={c}>
                    {c} · {currencyNames.of(c)}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="modal-label">
            {t('settlements.settings.fieldPg')}
            <input name="pgName" defaultValue={setting?.pgName ?? ''} maxLength={PG_NAME_MAX} required />
          </label>
          <label className="modal-label">
            {t('settlements.settings.fieldFeeRate')}
            <input type="number" name="feeRate" min={0} max={100} step={0.01} defaultValue={setting?.feeRate ?? 0} required />
          </label>
          <label className="modal-label">
            {t('settlements.settings.fieldPayDay')}
            <input type="number" name="payDay" min={1} max={PAY_DAY_MAX} step={1} defaultValue={setting?.payDay ?? 15} required />
          </label>

          {state.error && <p style={{ color: '#c45b4d', fontSize: 12, margin: '12px 0 0' }}>{t(`errors.${state.error}`)}</p>}

          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary-button" disabled={pending}>
              {pending ? t('common.processing') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


'use client'

// 이용 정보 입력 칸 (Product.guide). VELTRA 상품 페이지의 항목에 맞춘다:
//  - 예약 전 확인사항: 참가 제한 · 복장·준비물 · 신청 단위
//  - 취소료 기준(달력일/영업일 · 기준 시각) · 변경료  → 판매·예약 조건 카드의 취소 수수료 아래
//  - 리퀘스트 회신 시간 → 확정 방식이 리퀘스트(quote)일 때만
//  - 이용 정보: 집합 장소·지도 · 픽업 · 현지 연락처 · 긴급 연락처(대응 언어·운영 시간)
// 전부 선택 입력이다. 빈 칸은 빠른 보기·고객 화면에 안 보인다.

import { useTranslations } from 'next-intl'
import {
  CANCEL_BASES,
  CONTACT_LANGUAGES,
  type Category,
  type Contact,
  type ContactLanguage,
  type ProductGuide,
} from '@/lib/products/types'

type Props = { value: ProductGuide; onChange: (v: ProductGuide) => void }

const ageNum = (s: string): number | null => {
  const n = Number(s)
  return s.trim() === '' || !Number.isInteger(n) || n < 0 || n > 120 ? null : n
}

/** 예약 전 확인사항 카드 */
export function GuideBeforeBooking({ value, onChange }: Props) {
  const t = useTranslations('products.guide')
  const set = (patch: Partial<ProductGuide>) => onChange({ ...value, ...patch })
  return (
    <div className="proto-card">
      <div className="proto-section-head">
        <h3>{t('beforeTitle')}</h3>
      </div>
      <p className="proto-hint">{t('beforeHint')}</p>
      <label className="proto-field">
        <span>{t('restrictions')}</span>
        <textarea value={value.restrictions} onChange={(e) => set({ restrictions: e.target.value })} rows={3} placeholder={t('restrictionsPlaceholder')} />
      </label>
      <label className="proto-field">
        <span>{t('belongings')}</span>
        <textarea value={value.belongings} onChange={(e) => set({ belongings: e.target.value })} rows={3} placeholder={t('belongingsPlaceholder')} />
      </label>
      <label className="proto-field">
        <span>{t('bookingUnit')}</span>
        <input value={value.bookingUnit} onChange={(e) => set({ bookingUnit: e.target.value })} placeholder={t('bookingUnitPlaceholder')} />
      </label>
    </div>
  )
}

/** 이용 정보 카드: 집합·픽업·연락처 (바우처에 들어가는 정보) */
export function GuideUsage({ value, onChange }: Props) {
  const t = useTranslations('products.guide')
  const set = (patch: Partial<ProductGuide>) => onChange({ ...value, ...patch })
  return (
    <div className="proto-card">
      <div className="proto-section-head">
        <h3>{t('usageTitle')}</h3>
      </div>
      <p className="proto-hint">{t('usageHint')}</p>
      <div className="proto-grid-2">
        <label className="proto-field">
          <span>{t('meetingPoint')}</span>
          <input value={value.meetingPoint} onChange={(e) => set({ meetingPoint: e.target.value })} placeholder={t('meetingPointPlaceholder')} />
        </label>
        <label className="proto-field">
          <span>{t('meetingMapUrl')}</span>
          <input value={value.meetingMapUrl} onChange={(e) => set({ meetingMapUrl: e.target.value })} placeholder="https://maps.google.com/…" inputMode="url" />
        </label>
      </div>
      <div className="proto-field">
        <span>{t('pickup')}</span>
        <div className="proto-sign" role="group" aria-label={t('pickup')}>
          <button type="button" aria-pressed={!value.pickup} onClick={() => set({ pickup: false })}>
            {t('pickupNo')}
          </button>
          <button type="button" aria-pressed={value.pickup} onClick={() => set({ pickup: true })}>
            {t('pickupYes')}
          </button>
        </div>
      </div>
      {value.pickup && (
        <label className="proto-field">
          <span>{t('pickupNote')}</span>
          <textarea value={value.pickupNote} onChange={(e) => set({ pickupNote: e.target.value })} rows={2} placeholder={t('pickupNotePlaceholder')} />
        </label>
      )}
      <ContactFields title={t('localContact')} hint={t('localContactHint')} value={value.localContact} onChange={(c) => set({ localContact: c })} showName />
      <ContactFields title={t('emergencyContact')} hint={t('emergencyContactHint')} value={value.emergencyContact} onChange={(c) => set({ emergencyContact: c })} />
    </div>
  )
}

function ContactFields({ title, hint, value, onChange, showName = false }: { title: string; hint: string; value: Contact; onChange: (c: Contact) => void; showName?: boolean }) {
  const t = useTranslations('products.guide')
  const set = (patch: Partial<Contact>) => onChange({ ...value, ...patch })
  const toggle = (l: ContactLanguage) => set({ languages: value.languages.includes(l) ? value.languages.filter((x) => x !== l) : [...value.languages, l] })
  return (
    <fieldset className="guide-contact">
      <legend>{title}</legend>
      <p className="proto-hint">{hint}</p>
      <div className="proto-grid-2">
        {showName && (
          <label className="proto-field">
            <span>{t('contactName')}</span>
            <input value={value.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
        )}
        <label className="proto-field">
          <span>{t('contactPhone')}</span>
          <input value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+81-…" inputMode="tel" />
        </label>
        <label className="proto-field">
          <span>{t('contactHours')}</span>
          <input value={value.hours} onChange={(e) => set({ hours: e.target.value })} placeholder={t('contactHoursPlaceholder')} />
        </label>
      </div>
      <div className="proto-field">
        <span>{t('contactLanguages')}</span>
        <div className="proto-sign guide-langs" role="group" aria-label={t('contactLanguages')}>
          {CONTACT_LANGUAGES.map((l) => (
            <button key={l} type="button" aria-pressed={value.languages.includes(l)} onClick={() => toggle(l)}>
              {t(`lang.${l}`)}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  )
}

/** 취소 수수료 표 아래: 세는 기준(달력일/영업일) · 기준 시각 · 변경료 */
export function GuideCancelExtras({ value, onChange }: Props) {
  const t = useTranslations('products.guide')
  const set = (patch: Partial<ProductGuide>) => onChange({ ...value, ...patch })
  return (
    <>
      <div className="proto-field">
        <span>{t('cancelBasis')}</span>
        <span className="proto-range">
          <span className="proto-sign" role="group" aria-label={t('cancelBasis')}>
            {CANCEL_BASES.map((b) => (
              <button key={b} type="button" aria-pressed={value.cancelBasis === b} onClick={() => set({ cancelBasis: b })}>
                {t(`basis.${b}`)}
              </button>
            ))}
          </span>
          <span className="guide-inline">
            {t('cutoffLabel')}
            <input
              type="time"
              className="guide-time"
              value={value.cancelCutoffTime}
              onChange={(e) => set({ cancelCutoffTime: e.target.value })}
              aria-label={t('cutoffLabel')}
            />
          </span>
        </span>
        <p className="proto-hint">{t('cancelBasisHint')}</p>
      </div>
      <label className="proto-field">
        <span>{t('changeFee')}</span>
        <textarea value={value.changeFee} onChange={(e) => set({ changeFee: e.target.value })} rows={2} placeholder={t('changeFeePlaceholder')} />
      </label>
    </>
  )
}

/** 확정 방식이 리퀘스트일 때: 접수 가능 여부를 알려 주기까지 걸리는 시간 */
export function GuideRequestReply({ value, onChange }: Props) {
  const t = useTranslations('products.guide')
  return (
    <div className="proto-field">
      <span>{t('requestReply')}</span>
      <span className="proto-range">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={720}
          className="guide-num"
          value={value.requestReplyHours ?? ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange({ ...value, requestReplyHours: e.target.value === '' || !Number.isInteger(n) || n < 1 ? null : Math.min(720, n) })
          }}
          aria-label={t('requestReply')}
        />
        {t('requestReplySuffix')}
      </span>
      <p className="proto-hint">{t('requestReplyHint')}</p>
    </div>
  )
}

/** 요금표 열 머리글 안: 나이 범위 (예: 3 ~ 17세) */
export function CategoryAge({ category, onChange }: { category: Category; onChange: (patch: Partial<Category>) => void }) {
  const t = useTranslations('products.guide')
  return (
    <div className="guide-age">
      <input
        inputMode="numeric"
        value={category.ageMin ?? ''}
        onChange={(e) => onChange({ ageMin: ageNum(e.target.value) })}
        aria-label={t('ageMin')}
        placeholder={t('ageMinPlaceholder')}
      />
      ~
      <input
        inputMode="numeric"
        value={category.ageMax ?? ''}
        onChange={(e) => onChange({ ageMax: ageNum(e.target.value) })}
        aria-label={t('ageMax')}
        placeholder={t('ageMaxPlaceholder')}
      />
      <span>{t('ageSuffix')}</span>
    </div>
  )
}

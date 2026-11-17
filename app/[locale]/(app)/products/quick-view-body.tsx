'use client'

// 빠른 보기 본문. VELTRA 상품 상세 화면의 배치를 따른다 (색·로고는 우리 것):
//  사진 그리드(큰 1장 + 작은 4장) → 요금 줄(최저가) → 왼쪽: 소개·요금표(나이 범위)·예약 전 확인사항(회색 박스 2단)·취소료/변경료
//  / 오른쪽: 확정 방식 안내 줄 · 이용 정보(집합·픽업·연락처) · 날짜별 정원
// 빈 칸은 그리지 않는다 — 예전 상품(이용 정보 없음)도 그대로 보인다.

import { useTranslations } from 'next-intl'
import { CalendarCheck, Clock, MapPin, Phone, ShieldAlert } from 'lucide-react'
import { priceFrom, type Category, type Contact, type ProductFull } from '@/lib/products/types'
import type { DateCapacity } from '@/lib/server/products/service'
import { CapacityCalendar } from './capacity-calendar'
import { formatYen } from './_form/fields'

export function QuickViewBody({
  display,
  month,
  capacity,
  onMonthChange,
  loading,
}: {
  display: ProductFull
  month: string
  capacity: Record<string, DateCapacity>
  onMonthChange: (month: string) => void
  loading: boolean
}) {
  const tp = useTranslations('products')
  const tg = useTranslations('products.guide')
  const g = display.guide
  const base = priceFrom(display.priceTable)
  const images = display.images.slice(0, 5)

  const before = [
    { title: tg('restrictions'), text: g.restrictions },
    { title: tg('belongings'), text: g.belongings },
    { title: tg('bookingUnit'), text: g.bookingUnit },
  ].filter((x) => x.text.trim())

  const cancelNote = [
    g.cancelBasis === 'business' ? tg('basisNote.business') : '',
    g.cancelCutoffTime ? tg('basisNote.cutoff', { time: g.cancelCutoffTime }) : '',
  ].filter(Boolean)

  return (
    <div className="qv">
      {images.length > 0 && (
        <div className={`qv-gallery qv-gallery-${Math.min(images.length, 5)}`}>
          {images.map((src, i) => (
            // 저장소 사진 URL 을 그대로 쓴다 (목록·수정 화면과 같은 방식)
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className={i === 0 ? 'qv-main' : undefined} />
          ))}
        </div>
      )}

      <div className="qv-plan-bar">
        <span className={`qv-badge ${display.confirmType === 'instant' ? 'qv-badge-instant' : 'qv-badge-request'}`}>{tp(`confirm.${display.confirmType}`)}</span>
        <span className="qv-price">{base === null ? '—' : tp('fromPrice', { price: formatYen(base) })}</span>
      </div>

      <div className="qv-cols">
        <div>
          {display.description && <p className="qv-desc">{display.description}</p>}

          <PriceTable display={display} />

          {before.length > 0 && (
            <section className="qv-box">
              <h4>{tg('beforeTitle')}</h4>
              <div className="qv-box-grid">
                {before.map((b) => (
                  <div key={b.title}>
                    <p className="qv-sub">{b.title}</p>
                    <Bullets text={b.text} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {(display.cancelRules.length > 0 || g.changeFee) && (
            <section className="qv-section">
              {display.cancelRules.length > 0 && (
                <>
                  <h4>{tp('cancelPolicy')}</h4>
                  <ul className="qv-list">
                    {display.cancelRules.map((r, i) => (
                      <li key={i}>{tp('quickView.cancelRule', { days: r.daysBefore, percent: r.percent })}</li>
                    ))}
                    <li>{tg('cancelAfter')}</li>
                  </ul>
                  {cancelNote.length > 0 && <p className="qv-note">{cancelNote.join(' · ')}</p>}
                </>
              )}
              {g.changeFee && (
                <>
                  <h4>{tg('changeFee')}</h4>
                  <Bullets text={g.changeFee} />
                </>
              )}
            </section>
          )}
        </div>

        <div>
          <div className="qv-status">
            <p>
              <CalendarCheck size={15} />
              <b>{tp(`confirm.${display.confirmType}`)}</b>
              <span>
                {display.confirmType === 'instant'
                  ? tg('statusInstant')
                  : g.requestReplyHours
                    ? tg('statusRequestHours', { hours: g.requestReplyHours })
                    : tg('statusRequest')}
              </span>
            </p>
            <p>
              <Clock size={15} />
              <b>{tp('quickView.deadline')}</b>
              <span>{tp('quickView.deadlineText', { days: display.deadlineDays, time: display.deadlineTime })}</span>
            </p>
          </div>

          {(g.meetingPoint || g.pickup || hasContact(g.localContact) || hasContact(g.emergencyContact)) && (
            <section className="qv-section">
              <h4>{tg('usageTitle')}</h4>
              {g.meetingPoint && (
                <p className="qv-line">
                  <MapPin size={14} />
                  <span>
                    <b>{tg('meetingPoint')}</b> {g.meetingPoint}
                    {g.meetingMapUrl && (
                      <>
                        {' '}
                        <a href={g.meetingMapUrl} target="_blank" rel="noreferrer">
                          {tg('openMap')}
                        </a>
                      </>
                    )}
                  </span>
                </p>
              )}
              {g.pickup && (
                <p className="qv-line">
                  <MapPin size={14} />
                  <span>
                    <b>{tg('pickupYes')}</b> {g.pickupNote}
                  </span>
                </p>
              )}
              <ContactLine icon={<Phone size={14} />} title={tg('localContact')} c={g.localContact} />
              <ContactLine icon={<ShieldAlert size={14} />} title={tg('emergencyContact')} c={g.emergencyContact} />
            </section>
          )}

          <section className="qv-section">
            <h4>{tp('quickView.capacityTitle')}</h4>
            <CapacityCalendar month={month} capacity={capacity} onMonthChange={onMonthChange} loading={loading} />
          </section>
        </div>
      </div>
    </div>
  )
}

const hasContact = (c: Contact) => !!(c.name || c.phone || c.hours)

function ContactLine({ icon, title, c }: { icon: React.ReactNode; title: string; c: Contact }) {
  const tg = useTranslations('products.guide')
  if (!hasContact(c)) return null
  const langs = c.languages.map((l) => tg(`lang.${l}`)).join(' · ')
  return (
    <p className="qv-line">
      {icon}
      <span>
        <b>{title}</b> {[c.name, c.phone].filter(Boolean).join(' ')}
        {(c.hours || langs) && <em>{[langs && tg('languagesOk', { langs }), c.hours].filter(Boolean).join(' / ')}</em>}
      </span>
    </p>
  )
}

/** 줄마다 점 목록. 한 줄뿐이면 문단 */
function Bullets({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.replace(/^[\s・•\-*]+/, '').trim()).filter(Boolean)
  if (lines.length <= 1) return <p className="qv-text">{lines[0] ?? ''}</p>
  return (
    <ul className="qv-list">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  )
}

/** 요금표. 열 머리글에 나이 범위를 붙인다 — 「아동 (3~17세)」 */
function PriceTable({ display }: { display: ProductFull }) {
  const tg = useTranslations('products.guide')
  const { categories, plans, roomTypes, roomPricing } = display.priceTable
  const ageText = (c: Category) => {
    const min = c.ageMin ?? null
    const max = c.ageMax ?? null
    if (min === null && max === null) return ''
    if (min !== null && max !== null) return tg('ageRange', { min, max })
    return min !== null ? tg('ageFrom', { min }) : tg('ageTo', { max: max! })
  }
  if (roomTypes.length > 0) {
    return (
      <table className="qv-table">
        <tbody>
          {roomTypes.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{typeof roomPricing.base[r.id]?.price === 'number' ? formatYen(roomPricing.base[r.id].price!) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  const priced = plans.filter((pl) => categories.some((c) => typeof pl.prices[c.id] === 'number'))
  if (categories.length === 0 || priced.length === 0) return null
  return (
    <table className="qv-table">
      <thead>
        <tr>
          <th />
          {categories.map((c) => (
            <th key={c.id}>
              {c.name}
              {ageText(c) && <small>{ageText(c)}</small>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {priced.map((pl) => (
          <tr key={pl.id}>
            <td>{pl.name}</td>
            {categories.map((c) => (
              <td key={c.id}>{typeof pl.prices[c.id] === 'number' ? formatYen(pl.prices[c.id]!) : '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

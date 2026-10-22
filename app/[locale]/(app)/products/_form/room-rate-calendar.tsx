'use client'

// 숙박 "3. 객실 요금" — 기본 요금(모든 날짜 공통) + 기간별 예외.
// sale-calendar.tsx의 월 달력 틀(월 이동, 날짜/기간 선택 팝업)을 그대로 따르되,
// 요일·회차·인원 단계는 없다 — 숙박은 1박 단위라 날짜별 객실 요금만 정하면 된다.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { DateField } from '@/components/date-fields'
import { isHoliday, weekday } from '@/lib/products/jp-calendar'
import type { RoomPricing, RoomRate, RoomRateException, RoomType } from '@/lib/products/types'

const uid = () => Math.random().toString(36).slice(2, 8)
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const short = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
const order = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a])
const emptyRate = (): RoomRate => ({ price: null, count: null })

function today() {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`)
/** 팝업 제목: "11월 2일 (월)" / "11월 2일 (월)~6일 (금)" — 언어별 표기는 Intl이 정한다 */
function rangeTitle(locale: string, a: string, b: string) {
  const f = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
  return a === b ? f.format(utc(a)) : f.formatRange(utc(a), utc(b))
}

/** 날짜 d에 적용되는 객실 요금 — 예외 중 그 날짜를 포함하는 가장 나중 것, 없으면 기본값 */
function rateFor(value: RoomPricing, roomTypeId: string, d: string): RoomRate {
  for (let i = value.exceptions.length - 1; i >= 0; i--) {
    const e = value.exceptions[i]
    if (e.start <= d && d <= e.end && e.rates[roomTypeId]) return e.rates[roomTypeId]
  }
  return value.base[roomTypeId] ?? emptyRate()
}
function exceptionFor(value: RoomPricing, d: string): RoomRateException | null {
  for (let i = value.exceptions.length - 1; i >= 0; i--) {
    const e = value.exceptions[i]
    if (e.start <= d && d <= e.end) return e
  }
  return null
}

function RateTable({
  roomTypes,
  tp,
  get,
  set,
}: {
  roomTypes: RoomType[]
  tp: (key: string) => string
  get: (roomTypeId: string) => RoomRate
  set: (roomTypeId: string, patch: Partial<RoomRate>) => void
}) {
  return (
    <div className="rr-table">
      <div className="rr-row rr-head">
        <span />
        <span>{tp('pkg.roomRatePriceLabel')}</span>
        <span>{tp('pkg.roomRateCountLabel')}</span>
      </div>
      {roomTypes.map((rt) => {
        const r = get(rt.id)
        return (
          <div className="rr-row" key={rt.id}>
            <b>{rt.name || '—'}</b>
            <span className="proto-yen">
              <input
                type="number"
                inputMode="numeric"
                value={r.price ?? ''}
                onChange={(e) => set(rt.id, { price: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="0"
              />
              <span>{tp('yenUnit')}</span>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={r.count ?? ''}
              onChange={(e) => set(rt.id, { count: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="0"
            />
          </div>
        )
      })}
    </div>
  )
}

type Props = { roomTypes: RoomType[]; value: RoomPricing; onChange: (v: RoomPricing) => void }

export function RoomRateCalendar({ roomTypes, value, onChange }: Props) {
  const tp = useTranslations('products')
  const t = useTranslations('common')
  const locale = useLocale()
  // 요일 이름 0=일 … 6=토 (2023-01-01이 일요일)
  const week = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))))
  }, [locale])
  const start = today()
  const [cursor, setCursor] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 })
  const move = (n: number) => setCursor(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }))

  type Draft = { start: string; end: string; range: boolean; rates: Record<string, RoomRate> }
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null)

  const cells = useMemo(() => {
    const first = ymd(cursor.y, cursor.m, 1)
    const last = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()
    return [...Array<null>(weekday(first)).fill(null), ...Array.from({ length: last }, (_, i) => ymd(cursor.y, cursor.m, i + 1))]
  }, [cursor])

  useLayoutEffect(() => {
    if (!draft || !gridRef.current) return setPopPos(null)
    const cell =
      gridRef.current.querySelector<HTMLElement>(`[data-date="${draft.start}"]`) ?? gridRef.current.querySelector<HTMLElement>(`[data-date="${draft.end}"]`)
    if (!cell) return setPopPos(null)
    const gw = gridRef.current.clientWidth
    const gh = gridRef.current.clientHeight
    const pw = popRef.current?.offsetWidth ?? 280
    const ph = popRef.current?.offsetHeight ?? 160
    const below = cell.offsetTop + cell.offsetHeight + 4
    const top = cell.offsetTop > gh / 2 ? cell.offsetTop - ph - 4 : below
    setPopPos({ top, left: Math.max(0, Math.min(cell.offsetLeft, gw - pw)) })
  }, [draft?.start, draft?.end, draft?.range, cursor])

  const picking = !!draft && draft.range && draft.start === draft.end
  const clickDay = (d: string) => {
    if (picking && draft) {
      if (d === draft.start) return setDraft({ ...draft, range: false })
      const [a, b] = order(draft.start, d)
      return setDraft({ ...draft, start: a, end: b })
    }
    setDraft({ start: d, end: d, range: false, rates: Object.fromEntries(roomTypes.map((rt) => [rt.id, rateFor(value, rt.id, d)])) })
  }

  const inDraft = (d: string) => {
    if (!draft) return false
    const [a, b] = draft.range && draft.start === draft.end && hover ? order(draft.start, hover) : [draft.start, draft.end]
    return a <= d && d <= b
  }

  const draftEx = draft && draft.start === draft.end ? exceptionFor(value, draft.start) : null

  const applyDraft = () => {
    if (!draft) return
    const ex: RoomRateException = { id: draftEx?.id ?? uid(), start: draft.start, end: draft.end, rates: draft.rates }
    const exceptions = draftEx ? value.exceptions.filter((e) => e.id !== draftEx.id) : value.exceptions
    onChange({ ...value, exceptions: [...exceptions, ex] })
    setDraft(null)
  }
  const removeEx = (id: string) => onChange({ ...value, exceptions: value.exceptions.filter((e) => e.id !== id) })

  const setBaseRate = (roomTypeId: string, patch: Partial<RoomRate>) =>
    onChange({ ...value, base: { ...value.base, [roomTypeId]: { ...(value.base[roomTypeId] ?? emptyRate()), ...patch } } })
  const setDraftRate = (roomTypeId: string, patch: Partial<RoomRate>) =>
    draft && setDraft({ ...draft, rates: { ...draft.rates, [roomTypeId]: { ...(draft.rates[roomTypeId] ?? emptyRate()), ...patch } } })

  return (
    <div className="sc">
      <p className="sc-q">{tp('pkg.roomBaseRateTitle')}</p>
      <RateTable roomTypes={roomTypes} tp={tp} get={(id) => value.base[id] ?? emptyRate()} set={setBaseRate} />

      <div className="sc-cal-head">
        <p className="sc-q">{tp('pkg.roomDateRateQuestion')}</p>
        <span className="sc-toolbar">
          <button type="button" className="sc-nav" onClick={() => move(-1)} aria-label={tp('pkg.prevMonth')}>‹</button>
          <strong>{cursor.y}.{cursor.m + 1}</strong>
          <button type="button" className="sc-nav" onClick={() => move(1)} aria-label={tp('pkg.nextMonth')}>›</button>
        </span>
      </div>
      {picking && draft ? (
        <div className="sc-picking" role="status">
          <span>{tp('pkg.pickingFromDate', { date: rangeTitle(locale, draft.start, draft.start) })}</span>
          <button type="button" className="sc-link" onClick={() => setDraft(null)}>{t('cancel')}</button>
        </div>
      ) : (
        <p className="sc-q-sub">{tp('pkg.roomDateRateHint')}</p>
      )}

      <div className="sc-grid-wrap" ref={gridRef}>
        <div className="sc-grid" onMouseLeave={() => setHover(null)}>
          {week.map((w, i) => (
            <div key={i} className={`sc-week${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{w}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />
            const wd = weekday(d)
            const ex = exceptionFor(value, d)
            const cls = ['sc-day', wd === 0 || isHoliday(d) ? 'sun' : wd === 6 ? 'sat' : '', ex ? 'ex' : '', inDraft(d) ? 'sel' : ''].join(' ')
            return (
              <button
                key={d}
                type="button"
                data-date={d}
                className={cls}
                disabled={d < start}
                onClick={() => clickDay(d)}
                onMouseEnter={() => draft?.range && draft.start === draft.end && setHover(d)}
              >
                <span className="sc-num">{Number(d.slice(8))}</span>
              </button>
            )
          })}
        </div>

        {draft && !picking && (
          <div className="sc-pop" ref={popRef} role="dialog" aria-label={tp('pkg.roomRateTitle')} style={popPos ? { top: popPos.top, left: popPos.left } : { visibility: 'hidden' }}>
            <div className="sc-pop-head">
              <div><b>{rangeTitle(locale, draft.start, draft.end)}</b></div>
              <button type="button" className="proto-remove" onClick={() => setDraft(null)} aria-label={t('close')}>✕</button>
            </div>
            <div className="sc-span">
              <div className="sc-seg" role="radiogroup" aria-label={tp('pkg.dayOrRange')}>
                <button type="button" role="radio" aria-checked={!draft.range} onClick={() => setDraft({ ...draft, range: false, end: draft.start })}>{tp('pkg.dayOnly')}</button>
                <button type="button" role="radio" aria-checked={draft.range} onClick={() => setDraft({ ...draft, range: true, end: draft.start })}>{tp('pkg.dayRange')}</button>
              </div>
              {draft.range && (
                <div className="sc-span-row">
                  <span>{short(draft.start)} ~</span>
                  <DateField
                    value={draft.end}
                    min={draft.start}
                    onChange={(v) => v && setDraft({ ...draft, end: v < draft.start ? draft.start : v })}
                    ariaLabel={tp('pkg.endDate')}
                  />
                </div>
              )}
            </div>
            <RateTable roomTypes={roomTypes} tp={tp} get={(id) => draft.rates[id] ?? emptyRate()} set={setDraftRate} />
            <div className="sc-pop-actions">
              {draftEx && (
                <button type="button" className="sc-link" onClick={() => { removeEx(draftEx.id); setDraft(null) }}>
                  {tp('pkg.revertToDefault')}
                </button>
              )}
              <button type="button" className="sc-btn" onClick={() => setDraft(null)}>{t('cancel')}</button>
              <button type="button" className="sc-btn primary" onClick={applyDraft}>{tp('pkg.applyLabel')}</button>
            </div>
          </div>
        )}
      </div>

      {value.exceptions.length > 0 && (
        <div className="sc-ex-list">
          <span className="sc-base-label">{tp('pkg.roomExceptionLabel')}</span>
          {value.exceptions.map((e) => (
            <span key={e.id} className="sc-ex-chip">
              {e.start === e.end ? short(e.start) : `${short(e.start)}~${short(e.end)}`}
              <button type="button" onClick={() => removeEx(e.id)} aria-label={tp('pkg.removeException')}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

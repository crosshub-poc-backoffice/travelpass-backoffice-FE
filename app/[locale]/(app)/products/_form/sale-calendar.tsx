'use client'

// 판매 일정 = 기본 일정 1개 + 예외 여러 개.
// - 기본 일정: 기간 + 요일 + 인원. 상품 대부분은 "1년 · 평일 · 2~20명" 같은 패턴 하나로 끝난다.
// - 예외: 달력에서 날짜를 눌러 그날(또는 기간)만 쉬거나 인원을 바꾼다. 예외는 기본 일정보다 우선하고, 예외끼리 겹치면 나중 것이 이긴다.
// - 회차(times): 비우면 하루 단위, 넣으면 인원을 회차마다 따로 받는다. 보통은 모든 회차가 같은 인원이고,
//   야간 투어처럼 회차마다 다르면 slotPeople에 회차별로 적는다.
//   예외는 보통 날짜 단위(그날 전 회차 쉼/인원 변경)이고, 필요하면 '회차별로 정해요'로 회차마다 판매·쉼·인원을 따로 건다.
// 인원(최소~최대)은 즉시 확정 상품만 받는다. 업체 확인 후 확정은 업체가 예약마다 자리를 보고 승인하니 "어느 날 파는지"만 정한다.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { DateField } from '@/components/date-fields'
import { addDays, isHoliday, weekday } from '@/lib/products/jp-calendar'
import { resolve, type BaseSchedule, type People, type SaleSchedule, type ScheduleException, type SlotRule, type SlotState } from '@/lib/products/schedule'

export type ConfirmMode = 'instant' | 'quote'


// 회차 시각 고르기 목록: 00:00 ~ 23:45, 15분 단위
const QUARTER_TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
const uid = () => Math.random().toString(36).slice(2, 8)
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const GROUPS: { key: 'weekdays' | 'weekend'; days: number[] }[] = [
  { key: 'weekdays', days: [1, 2, 3, 4, 5] },
  { key: 'weekend', days: [6, 0] },
]
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const short = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
const order = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a])

function today() {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

/** start부터 n개월(마지막 날 포함) — 1/31 + 1개월은 2월 말일까지 */
function plusMonths(start: string, n: number) {
  const [y, m, d] = start.split('-').map(Number)
  const tm = m - 1 + n
  const ty = y + Math.floor(tm / 12)
  const mm = ((tm % 12) + 12) % 12
  const last = new Date(Date.UTC(ty, mm + 1, 0)).getUTCDate()
  return addDays(ymd(ty, mm, Math.min(d, last)), -1)
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`)
/** 요일 이름 0=일 … 6=토 (2023-01-01이 일요일) */
const weekNames = (locale: string, style: 'narrow' | 'short') => {
  const f = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))))
}
/** 팝업 제목: "11월 2일 (월)" / "11월 2일 (월)~6일 (금)" — 언어별 표기는 Intl이 정한다 */
function rangeTitle(locale: string, a: string, b: string) {
  const f = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
  return a === b ? f.format(utc(a)) : f.formatRange(utc(a), utc(b))
}
const dayCount = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1

export function emptySchedule(): SaleSchedule {
  return { base: { start: today(), end: '', weekdays: [0, 1, 2, 3, 4, 5, 6], times: [], slotPeople: {}, minPeople: 1, maxPeople: null }, exceptions: [] }
}


type T = (key: string, values?: Record<string, string | number>) => string
const peopleText = (t: T, p: People) => (p.maxPeople == null ? t('peopleUnset') : t('peopleRange', { min: p.minPeople ?? 1, max: p.maxPeople }))
const sortTimes = (t: string[]) => [...new Set(t)].sort()
const rangeText = (p: People) => `${p.minPeople ?? 1}~${p.maxPeople ?? ''}`
/** 회차마다 인원이 같은지 */
const samePeople = (slots: SlotState[]) => new Set(slots.map((x) => rangeText(x.people))).size <= 1
/** 회차별 상태 한 줄: "10:00 1~20명 · 14:00 쉼" */
const slotsText = (t: T, slots: SlotState[], instant: boolean) =>
  slots.map((x) => `${x.time} ${!x.open ? t('closed') : instant ? peopleText(t, x.people) : t('sale')}`).join(' · ')

/** − 숫자 + */
function Stepper({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const t = useTranslations('products.saleCalendar')
  const n = value ?? 0
  return (
    <span className="sc-stepper">
      <button type="button" onClick={() => onChange(Math.max(1, n - 1))} aria-label={t('decrease', { label })}>−</button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
        aria-label={label}
      />
      <button type="button" onClick={() => onChange(n + 1)} aria-label={t('increase', { label })}>+</button>
    </span>
  )
}

function PeopleInput({ value, onChange, stacked }: { value: People; onChange: (p: People) => void; stacked?: boolean }) {
  const t = useTranslations('products.saleCalendar')
  if (stacked)
    return (
      <span className="sc-people stacked">
        <span>{t('min')}</span>
        <Stepper label={t('minPeople')} value={value.minPeople} onChange={(v) => onChange({ ...value, minPeople: v })} />
        <span>{t('peopleUnit')}</span>
        <span>{t('max')}</span>
        <Stepper label={t('maxPeople')} value={value.maxPeople} onChange={(v) => onChange({ ...value, maxPeople: v })} />
        <span>{t('peopleUnit')}</span>
      </span>
    )
  return (
    <span className="sc-people">
      {t('min')}
      <Stepper label={t('minPeople')} value={value.minPeople} onChange={(v) => onChange({ ...value, minPeople: v })} />
      ~ {t('max')}
      <Stepper label={t('maxPeople')} value={value.maxPeople} onChange={(v) => onChange({ ...value, maxPeople: v })} />
      {t('peopleUnit')}
    </span>
  )
}

const peopleError = (t: T, p: People) =>
  p.maxPeople == null || p.maxPeople < 1 ? t('errMaxPeople') : (p.minPeople ?? 1) > p.maxPeople ? t('errMinOverMax') : null

type Props = {
  value: SaleSchedule
  onChange: (v: SaleSchedule) => void
  mode: ConfirmMode
  // 숙박은 1박 단위라 "시간을 정해서 파나요?"/"날짜마다 몇 명 받나요?" 단계가 의미 없다 — 기간·요일만 묻는다
  hideCapacitySteps?: boolean
}

export function SaleCalendar({ value, onChange, mode, hideCapacitySteps = false }: Props) {
  const t = useTranslations('products.saleCalendar')
  const tp = useTranslations('products')
  const tc = useTranslations('common')
  const locale = useLocale()
  const weekNarrow = useMemo(() => weekNames(locale, 'narrow'), [locale])
  const weekShort = useMemo(() => weekNames(locale, 'short'), [locale])
  const start = today()
  const { base, exceptions } = value
  const setBase = (patch: Partial<BaseSchedule>) => onChange({ ...value, base: { ...base, ...patch } })
  const instant = mode === 'instant'
  // 인원수 개념을 쓰는지. 숙박은 즉시확정이어도 인원 대신 객실 요금·수량으로 재고를 관리하므로 꺼둔다
  const peopleInstant = instant && !hideCapacitySteps

  const [cursor, setCursor] = useState({ y: Number(base.start.slice(0, 4)), m: Number(base.start.slice(5, 7)) - 1 })
  const move = (n: number) => setCursor(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }))

  // 예외 편집 팝업: 누른 날(들) + 입력값
  /** range = '기간으로'를 고른 상태. 이때 달력에서 다른 날을 누르면 끝나는 날이 된다 */
  /** perSlot = '회차별로 정해요'를 고른 상태. 이때는 open·인원 대신 slots를 쓴다 */
  type Draft = { start: string; end: string; open: boolean; range: boolean; perSlot: boolean; slots: Record<string, SlotRule> } & People
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDraft(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cells = useMemo(() => {
    const first = ymd(cursor.y, cursor.m, 1)
    const last = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()
    return [...Array<null>(weekday(first)).fill(null), ...Array.from({ length: last }, (_, i) => ymd(cursor.y, cursor.m, i + 1))]
  }, [cursor])

  // 팝업은 누른 칸 바로 아래에 띄운다 (달력 밖으로 안 나가게 좌우만 맞춤)
  useLayoutEffect(() => {
    if (!draft || !gridRef.current) return setPopPos(null)
    const cell = gridRef.current.querySelector<HTMLElement>(`[data-date="${draft.start}"]`) ?? gridRef.current.querySelector<HTMLElement>(`[data-date="${draft.end}"]`)
    if (!cell) return setPopPos(null)
    const gw = gridRef.current.clientWidth
    const gh = gridRef.current.clientHeight
    const pw = popRef.current?.offsetWidth ?? 280
    const ph = popRef.current?.offsetHeight ?? 160
    const below = cell.offsetTop + cell.offsetHeight + 4
    // 달력 아래쪽 절반에 있는 칸이면 칸 위로, 아니면 칸 아래로 띄운다
    const top = cell.offsetTop > gh / 2 ? cell.offsetTop - ph - 4 : below
    setPopPos({ top, left: Math.max(0, Math.min(cell.offsetLeft, gw - pw)) })
  }, [draft?.start, draft?.end, draft?.range, draft?.open, draft?.perSlot, cursor])

  // '기간으로'를 누르면 팝업을 치우고 끝나는 날을 고르는 상태가 된다. 끝날을 누르면 기간이 잡힌 팝업이 다시 뜬다.
  const picking = !!draft && draft.range && draft.start === draft.end
  const clickDay = (d: string) => {
    if (picking && draft) {
      // 시작일을 다시 누르면 하루짜리로
      if (d === draft.start) return setDraft({ ...draft, range: false })
      const [a, b] = order(draft.start, d)
      return setDraft({ ...draft, start: a, end: b })
    }
    const cur = resolve(value, d)
    setDraft({
      start: d,
      end: d,
      range: false,
      perSlot: false,
      // 회차별 칸은 지금 상태로 채워 둔다 (인원이 비어 있으면 기본 인원)
      slots: Object.fromEntries(
        cur.slots.map((x) => {
          const fallback = base.slotPeople[x.time] ?? base
          return [x.time, { open: x.open, minPeople: x.people.minPeople ?? fallback.minPeople, maxPeople: x.people.maxPeople ?? fallback.maxPeople }]
        }),
      ),
      // 파는 날을 누르면 보통 "이날 쉼"을 하려는 것, 안 파는 날을 누르면 "이날 판매"
      open: !cur.open,
      minPeople: cur.people.minPeople ?? base.minPeople,
      maxPeople: cur.people.maxPeople ?? base.maxPeople,
    })
  }

  const peopleOf = (open: boolean, p: People) => (open && peopleInstant ? { minPeople: p.minPeople, maxPeople: p.maxPeople } : { minPeople: null, maxPeople: null })
  const draftError = !draft || !peopleInstant
    ? null
    : draft.perSlot
      ? base.times.map((x) => (draft.slots[x].open ? peopleError(t, draft.slots[x]) : null)).find(Boolean) ?? null
      : draft.open ? peopleError(t, draft) : null
  const applyDraft = () => {
    if (!draft || draftError) return
    const range = { id: uid(), start: draft.start, end: draft.end }
    const ex: ScheduleException = draft.perSlot
      ? (() => {
          const slots = Object.fromEntries(base.times.map((t) => [t, { open: draft.slots[t].open, ...peopleOf(draft.slots[t].open, draft.slots[t]) }]))
          return { ...range, open: Object.values(slots).some((x) => x.open), minPeople: null, maxPeople: null, slots }
        })()
      : { ...range, open: draft.open, ...peopleOf(draft.open, draft), slots: {} }
    onChange({ ...value, exceptions: [...exceptions, ex] })
    setDraft(null)
  }
  const removeEx = (id: string) => onChange({ ...value, exceptions: exceptions.filter((e) => e.id !== id) })

  // 회차를 바꾸면 회차별 인원도 맞춘다: 지운 회차는 빼고, 새 회차는 기본 인원으로 채운다 (회차마다 다르게 쓰는 중일 때만).
  // 회차가 1개 이하로 줄면 '다르게'를 풀어 준다
  const split = Object.keys(base.slotPeople).length > 0
  const basePeople = { minPeople: base.minPeople, maxPeople: base.maxPeople }
  const setTimes = (times: string[]) =>
    setBase({ times, slotPeople: split && times.length > 1 ? Object.fromEntries(times.map((t) => [t, base.slotPeople[t] ?? basePeople])) : {} })
  const setSplit = (on: boolean) =>
    setBase(on ? { slotPeople: Object.fromEntries(base.times.map((t) => [t, basePeople])) } : { slotPeople: {} })
  const [slotted, setSlotted] = useState(base.times.length > 0)

  const hasTimes = base.times.length > 0
  // 시각 칸에서 고르면 바로 회차가 된다. 이어서 분을 바꾸는 등 시각을 또 고치면 방금 넣은 회차가 그 시각으로 바뀌고,
  // 칸을 다시 누르거나(시계 버튼 포함) 벗어나면 칸이 비워져 다음 회차를 새로 고른다
  const draftEx = draft && draft.start === draft.end ? resolve(value, draft.start).ex : null

  const inDraft = (d: string) => {
    if (!draft) return false
    const [a, b] = draft.range && draft.start === draft.end && hover ? order(draft.start, hover) : [draft.start, draft.end]
    return a <= d && d <= b
  }

  // 질문을 하나씩 보여준다: 기간 → 요일 → 시간 → 인원(즉시 확정만) → 예외 달력. 답한 질문은 한 줄 요약으로 접힌다.
  type StepKey = 'period' | 'days' | 'times' | 'people'
  const steps: StepKey[] = hideCapacitySteps ? ['period', 'days'] : instant ? ['period', 'days', 'times', 'people'] : ['period', 'days', 'times']
  const [reached, setReached] = useState(base.end ? steps.length : 0)
  const [active, setActive] = useState<StepKey | null>(base.end ? null : 'period')
  const done = Math.min(reached, steps.length)
  // 처음 한 번 질문을 다 끝내면 그 뒤로는 수정 중에도 달력을 계속 보여준다 (고치면서 결과를 바로 보게)
  const allDone = done >= steps.length

  // 확정 방식을 바꿔서 지금 열린 질문(인원)이 사라지면 접는다
  // 반대로 즉시 확정으로 바꿨는데 인원이 비어 있으면 인원 질문을 연다
  useEffect(() => {
    if (active && !steps.includes(active)) setActive(null)
    if (!hideCapacitySteps && instant && active === null && reached >= 3 && base.maxPeople == null) setActive('people')
  }, [active, steps, instant, reached, base.maxPeople, hideCapacitySteps])

  const next = (key: StepKey) => {
    const i = steps.indexOf(key)
    const following = steps.slice(i + 1).find((_, j) => i + 1 + j >= reached) ?? null
    setReached((r) => Math.max(r, i + 1))
    setActive(following)
    if (!following) setCursor({ y: Number(base.start.slice(0, 4)), m: Number(base.start.slice(5, 7)) - 1 })
  }

  const fullDate = (x: string) => `${x.slice(0, 4)}.${Number(x.slice(5, 7))}.${Number(x.slice(8, 10))}`
  const daysText = () => {
    const w = [...base.weekdays].sort().join('')
    return w === '0123456' ? t('everyDay') : w === '12345' ? t('monToFri') : w === '06' ? t('satSun') : WEEK_ORDER.filter((i) => base.weekdays.includes(i)).map((i) => weekShort[i]).join('·')
  }
  const summary: Record<StepKey, [string, string]> = {
    period: [t('summaryPeriod'), base.end ? `${fullDate(base.start)} ~ ${fullDate(base.end)}` : ''],
    days: [t('summaryDays'), daysText()],
    times: [t('summaryTimes'), hasTimes ? base.times.join(' · ') : t('byDay')],
    people: [
      t('summaryPeople'),
      split
        ? t('peopleList', { list: base.times.map((x) => `${x} ${rangeText(base.slotPeople[x])}`).join(' · ') })
        : hasTimes ? t('perSlotPeople', { people: peopleText(t, base) }) : peopleText(t, base),
    ],
  }
  const peopleErr = split ? base.times.map((x) => peopleError(t, base.slotPeople[x])).find(Boolean) ?? null : peopleError(t, base)

  const renderStep = (key: StepKey) => {
    if (key === 'period')
      return (
        <>
          <p className="sc-q">{t('qPeriod')}</p>
          <div className="sc-base-row">
            <DateField value={base.start} min={start} onChange={(v) => v && setBase({ start: v })} ariaLabel={t('startDate')} />
            ~
            <DateField value={base.end} min={base.start} onChange={(v) => setBase({ end: v })} ariaLabel={t('endDate')} />
          </div>
          <div className="sc-base-row">
            <span className="sc-quick-btns">
              {[3, 6, 12].map((n) => (
                <button key={n} type="button" className="sc-btn" onClick={() => setBase({ end: plusMonths(base.start, n) })}>
                  {n === 12 ? t('oneYear') : t('months', { n })}
                </button>
              ))}
            </span>
            <button type="button" className="sc-btn primary sc-next" disabled={!base.end} onClick={() => next('period')}>{t('next')}</button>
          </div>
        </>
      )
    if (key === 'days')
      return (
        <>
          <p className="sc-q">{t('qDays')}</p>
          <div className="sc-base-row">
            {/* 평일·주말은 요일을 묶어서 켜고 끄는 버튼. 해당 요일이 다 켜져 있으면 자동으로 체크된다 */}
            {GROUPS.map((g) => {
              const on = g.days.every((d) => base.weekdays.includes(d))
              return (
                <button
                  key={g.key}
                  type="button"
                  className="sc-group"
                  aria-pressed={on}
                  onClick={() =>
                    setBase({ weekdays: on ? base.weekdays.filter((d) => !g.days.includes(d)) : [...new Set([...base.weekdays, ...g.days])] })
                  }
                >
                  <span className="sc-group-box" aria-hidden="true">{on ? '✓' : ''}</span>
                  {t(g.key)}
                </button>
              )
            })}
          </div>
          <div className="sc-base-row">
            <span className="sc-day-chips" role="group" aria-label={t('saleDays')}>
              {WEEK_ORDER.map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={base.weekdays.includes(i)}
                  className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}
                  onClick={() => setBase({ weekdays: base.weekdays.includes(i) ? base.weekdays.filter((x) => x !== i) : [...base.weekdays, i] })}
                >
                  {weekShort[i]}
                </button>
              ))}
            </span>
          </div>
          <div className="sc-base-row">
            <button type="button" className="sc-btn primary sc-next" disabled={base.weekdays.length === 0} onClick={() => next('days')}>{t('next')}</button>
          </div>
        </>
      )
    if (key === 'times')
      return (
        <>
          <p className="sc-q">{t('qTimes')}</p>
          <div className="sc-seg" role="radiogroup" aria-label={t('dayOrSlot')}>
            <button type="button" role="radio" aria-checked={!slotted} onClick={() => { setSlotted(false); setTimes([]) }}>{t('byDay')}</button>
            <button type="button" role="radio" aria-checked={slotted} onClick={() => setSlotted(true)}>{t('bySlot')}</button>
          </div>
          {slotted && (
            <>
              <div className="sc-base-row">
                {base.times.map((time) => (
                  <span key={time} className="sc-time-chip">
                    {time}
                    <button type="button" onClick={() => setTimes(base.times.filter((x) => x !== time))} aria-label={t('removeSlot', { time })}>✕</button>
                  </span>
                ))}
                {/* 브라우저 기본 시간 칸은 오전/오후를 PC 언어로 보여줘서 15분 단위 목록으로 고르게 한다 */}
                <select
                  className="sc-time-pick"
                  value=""
                  onChange={(e) => e.target.value && setTimes(sortTimes([...base.times, e.target.value]))}
                  aria-label={t('addSlot')}
                >
                  <option value="">+ {t('addSlot')}</option>
                  {QUARTER_TIMES.filter((x) => !base.times.includes(x)).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="sc-base-row">
            <span className="sc-q-sub">{slotted ? t('slotHint') : t('dayHint')}</span>
            <button type="button" className="sc-btn primary sc-next" disabled={slotted && !hasTimes} onClick={() => next('times')}>{t('next')}</button>
          </div>
        </>
      )
    return (
      <>
        <p className="sc-q">{hasTimes ? t('qPeopleSlot') : t('qPeopleDay')}</p>
        {split ? (
          // 회차가 여러 줄이라 − + 버튼 없이 숫자칸만 둔 작은 표로 보여준다
          <div className="sc-slot-people">
            <span />
            <span>{t('min')}</span>
            <span>{t('max')}</span>
            <span />
            {base.times.map((time) => {
              const p = base.slotPeople[time]
              const set = (patch: Partial<People>) => setBase({ slotPeople: { ...base.slotPeople, [time]: { ...p, ...patch } } })
              const num = (v: string) => (v === '' ? null : Math.max(0, Number(v)))
              return (
                <Fragment key={time}>
                  <b>{time}</b>
                  <input type="number" inputMode="numeric" min={1} value={p.minPeople ?? ''} onChange={(e) => set({ minPeople: num(e.target.value) })} aria-label={t('slotMinPeople', { time })} />
                  <input type="number" inputMode="numeric" min={1} value={p.maxPeople ?? ''} onChange={(e) => set({ maxPeople: num(e.target.value) })} aria-label={t('slotMaxPeople', { time })} />
                  <span>{t('peopleUnit')}</span>
                </Fragment>
              )
            })}
          </div>
        ) : (
          <div className="sc-base-row">
            <PeopleInput value={base} onChange={(p) => setBase(p)} />
          </div>
        )}
        {base.times.length > 1 && (
          <button type="button" className="sc-link sc-split-link" onClick={() => setSplit(!split)}>
            {split ? t('splitOff') : t('splitOn')}
          </button>
        )}
        <div className="sc-base-row">
          {(split || base.maxPeople != null) && peopleErr ? <span className="sc-error">{peopleErr}</span> : <span className="sc-q-sub">{t('minHint')}</span>}
          <button type="button" className="sc-btn primary sc-next" disabled={!!peopleErr} onClick={() => next('people')}>{t('next')}</button>
        </div>
      </>
    )
  }

  return (
    <div className="sc">
      {steps.map((key, i) => {
        if (active === key)
          return (
            <div key={key} className="sc-step active">
              {renderStep(key)}
            </div>
          )
        if (i < done)
          return (
            <button key={key} type="button" className="sc-step done" onClick={() => setActive(key)}>
              <span className="sc-base-label">{summary[key][0]}</span>
              <span className="sc-step-val">{summary[key][1]}</span>
              <span className="sc-step-edit">{tc('edit')}</span>
            </button>
          )
        return null
      })}

      {allDone && (
        <>
          <div className="sc-cal-head">
            <p className="sc-q">{peopleInstant ? t('qExceptionsPeople') : t('qExceptionsSale')}</p>
            <span className="sc-toolbar">
              <button type="button" className="sc-nav" onClick={() => move(-1)} aria-label={tp('pkg.prevMonth')}>‹</button>
              <strong>{cursor.y}.{cursor.m + 1}</strong>
              <button type="button" className="sc-nav" onClick={() => move(1)} aria-label={tp('pkg.nextMonth')}>›</button>
            </span>
          </div>
          {picking && draft ? (
            <div className="sc-picking" role="status">
              <span>
                {t.rich('pickingFrom', { date: rangeTitle(locale, draft.start, draft.start), b: (c) => <b>{c}</b> })}
              </span>
              <button type="button" className="sc-link" onClick={() => setDraft(null)}>{tc('cancel')}</button>
            </div>
          ) : (
            <p className="sc-q-sub">{t('exceptionHint')}</p>
          )}

          <div className="sc-grid-wrap" ref={gridRef}>
            <div className="sc-grid" onMouseLeave={() => setHover(null)}>
              {weekNarrow.map((w, i) => (
                <div key={i} className={`sc-week${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{w}</div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`b${i}`} />
                const wd = weekday(d)
                const r = resolve(value, d)
                const cls = [
                  'sc-day',
                  wd === 0 || isHoliday(d) ? 'sun' : wd === 6 ? 'sat' : '',
                  r.open ? 'set' : '',
                  r.ex ? (r.open ? 'ex' : 'ex closed') : '',
                  inDraft(d) ? 'sel' : '',
                ].join(' ')
                // 일부 회차만 파는 날은 "2/3회", 회차마다 인원이 다르면 "3회" — 칸이 좁아서 자세한 건 마우스를 올리면 보인다
                const openN = r.slots.filter((x) => x.open).length
                const capText = !r.open
                  ? r.ex ? t('closed') : ''
                  : openN < r.slots.length
                    ? t('slotsOpen', { open: openN, total: r.slots.length })
                    : !peopleInstant ? '' : !samePeople(r.slots) ? t('slotsCount', { count: r.slots.length }) : r.people.maxPeople != null ? rangeText(r.people) : ''
                return (
                  <button
                    key={d}
                    type="button"
                    data-date={d}
                    className={cls}
                    disabled={d < start}
                    onClick={() => clickDay(d)}
                    onMouseEnter={() => draft?.range && draft.start === draft.end && setHover(d)}
                    title={hasTimes && (r.open || r.ex) ? slotsText(t, r.slots, peopleInstant) : r.open ? (peopleInstant ? peopleText(t, r.people) : t('sale')) : r.ex ? t('closed') : t('notForSale')}
                  >
                    <span className="sc-num">{Number(d.slice(8))}</span>
                    {capText && <span className="sc-cap">{capText}</span>}
                  </button>
                )
              })}
            </div>

            {draft && !picking && (() => {
              const single = !draft.range
              const cur = resolve(value, draft.start)
              // 업체 확인 방식에서 이미 파는 하루는 "판매"를 다시 고를 이유가 없어서 쉬는 선택지만 보여준다
              const showOpen = !(single && cur.open && !peopleInstant)
              const openLabel = single && cur.open && peopleInstant ? t('openChangePeople') : single ? t('openDay') : t('openRange')
              const status = single
                ? cur.open && (cur.slots.some((x) => !x.open) || (peopleInstant && !samePeople(cur.slots)))
                  ? `${cur.ex ? t('statusEx') : t('statusBase')} · ${slotsText(t, cur.slots, peopleInstant)}`
                  : cur.ex
                  ? cur.open ? `${t('statusEx')} · ${peopleInstant ? peopleText(t, cur.people) : t('sale')}` : t('statusClosedEx')
                  : cur.open ? `${t('statusBase')} · ${peopleInstant ? peopleText(t, cur.people) : t('sale')}` : `${t('statusNotInBase')} · ${t('notForSale')}`
                : draft.start === draft.end ? t('pickEnd') : t('dayCount', { count: dayCount(draft.start, draft.end) })
              return (
                <div className="sc-pop" ref={popRef} role="dialog" aria-label={t('popLabel')} style={popPos ? { top: popPos.top, left: popPos.left } : { visibility: 'hidden' }}>
                  <div className="sc-pop-head">
                    <div>
                      <b>{rangeTitle(locale, draft.start, draft.end)}</b>
                      <p>{status}</p>
                    </div>
                    <button type="button" className="proto-remove" onClick={() => setDraft(null)} aria-label={tc('close')}>✕</button>
                  </div>

                  <div className="sc-span">
                    <div className="sc-seg" role="radiogroup" aria-label={tp('pkg.dayOrRange')}>
                      <button type="button" role="radio" aria-checked={single} onClick={() => setDraft({ ...draft, range: false, end: draft.start })}>{tp('pkg.dayOnly')}</button>
                      <button type="button" role="radio" aria-checked={!single} onClick={() => setDraft({ ...draft, range: true, end: draft.start })}>{tp('pkg.dayRange')}</button>
                    </div>
                    {!single && (
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

                  <div className="sc-opts" role="radiogroup" aria-label={t('howThisDay')}>
                    <button type="button" role="radio" aria-checked={!draft.perSlot && !draft.open} className="sc-opt" onClick={() => setDraft({ ...draft, open: false, perSlot: false })}>
                      <span className="sc-radio" aria-hidden="true" />
                      <span>
                        <b>{single ? t('closeDay') : t('closeRange')}</b>
                        <em>{t('noBookings')}</em>
                      </span>
                    </button>
                    {showOpen && (
                      <div className={`sc-opt${!draft.perSlot && draft.open ? ' on' : ''}`}>
                        <button type="button" role="radio" aria-checked={!draft.perSlot && draft.open} className="sc-opt-btn" onClick={() => setDraft({ ...draft, open: true, perSlot: false })}>
                          <span className="sc-radio" aria-hidden="true" />
                          <span>
                            <b>{openLabel}</b>
                            {!instant && <em>{t('partnerConfirms')}</em>}
                          </span>
                        </button>
                        {!draft.perSlot && draft.open && peopleInstant && (
                          <div className="sc-opt-body">
                            <PeopleInput stacked value={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
                            {draftError && <span className="sc-error">{draftError}</span>}
                          </div>
                        )}
                      </div>
                    )}
                    {base.times.length > 1 && (
                      <div className={`sc-opt${draft.perSlot ? ' on' : ''}`}>
                        <button type="button" role="radio" aria-checked={draft.perSlot} className="sc-opt-btn" onClick={() => setDraft({ ...draft, perSlot: true })}>
                          <span className="sc-radio" aria-hidden="true" />
                          <span>
                            <b>{t('perSlot')}</b>
                            <em>{instant ? t('perSlotInstant') : t('perSlotQuote')}</em>
                          </span>
                        </button>
                        {draft.perSlot && (
                          <div className="sc-slot-edit">
                            {base.times.map((time) => {
                              const x = draft.slots[time]
                              const set = (patch: Partial<SlotRule>) => setDraft({ ...draft, slots: { ...draft.slots, [time]: { ...x, ...patch } } })
                              const num = (v: string) => (v === '' ? null : Math.max(0, Number(v)))
                              return (
                                <Fragment key={time}>
                                  <b>{time}</b>
                                  <span className="sc-mini-seg" role="group" aria-label={t('slotSaleState', { time })}>
                                    <button type="button" aria-pressed={x.open} onClick={() => set({ open: true })}>{t('sale')}</button>
                                    <button type="button" aria-pressed={!x.open} onClick={() => set({ open: false })}>{t('closed')}</button>
                                  </span>
                                  {x.open && instant ? (
                                    <span className="sc-slot-range">
                                      <input type="number" inputMode="numeric" min={1} value={x.minPeople ?? ''} onChange={(e) => set({ minPeople: num(e.target.value) })} aria-label={t('slotMinPeople', { time })} />
                                      ~
                                      <input type="number" inputMode="numeric" min={1} value={x.maxPeople ?? ''} onChange={(e) => set({ maxPeople: num(e.target.value) })} aria-label={t('slotMaxPeople', { time })} />
                                      {t('peopleUnit')}
                                    </span>
                                  ) : (
                                    <span />
                                  )}
                                </Fragment>
                              )
                            })}
                            {draftError && <span className="sc-error sc-slot-err">{draftError}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>


                  <div className="sc-pop-actions">
                    {draftEx && (
                      <button type="button" className="sc-link" onClick={() => { removeEx(draftEx.id); setDraft(null) }}>
                        {tp('pkg.revertToDefault')}
                      </button>
                    )}
                    <button type="button" className="sc-btn" onClick={() => setDraft(null)}>{tc('cancel')}</button>
                    <button type="button" className="sc-btn primary" disabled={!!draftError} onClick={applyDraft}>{tp('pkg.applyLabel')}</button>
                  </div>
                </div>
              )
            })()}
          </div>

          {exceptions.length > 0 && (
            <div className="sc-ex-list">
              <span className="sc-base-label">{t('exceptionsLabel')}</span>
              {exceptions.map((e) => (
                <span key={e.id} className={`sc-ex-chip${e.open ? '' : ' closed'}`}>
                  {e.start === e.end ? short(e.start) : `${short(e.start)}~${short(e.end)}`}{' '}
                  {Object.keys(e.slots).length
                    ? base.times.filter((x) => e.slots[x]).map((x) => `${x} ${e.slots[x].open ? (peopleInstant ? rangeText(e.slots[x]) : t('sale')) : t('closed')}`).join(' · ')
                    : e.open ? (peopleInstant ? peopleText(t, e) : t('sale')) : t('closed')}
                  <button type="button" onClick={() => removeEx(e.id)} aria-label={tp('pkg.removeException')}>✕</button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

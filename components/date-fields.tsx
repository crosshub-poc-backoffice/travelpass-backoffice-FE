'use client'

// 날짜·월 선택칸. 브라우저 기본 <input type="date|month">는 앱 언어가 아니라 브라우저(OS) 언어로 표시돼서
// 일본어 화면에도 "2026년 10월"이 나온다 — 그래서 화면 언어(Intl)로 그리는 칸을 직접 둔다.
// 값은 기본 입력칸과 같은 문자열(YYYY-MM-DD / YYYY-MM)이고, name을 주면 숨은 input으로 폼에 같이 실린다.

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { jstToday } from '@/lib/datetime'

const pad = (n: number) => String(n).padStart(2, '0')
const utc = (value: string) => new Date(`${value}T00:00:00Z`)
const todayValue = jstToday // '오늘' 표시도 업무 기준 시간대(JST)

// 바깥 클릭·Esc로 닫기
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

// value를 주면 제어, defaultValue만 주면 칸이 스스로 값을 들고 있는다
function useFieldValue(value: string | undefined, defaultValue: string | undefined, onChange?: (v: string) => void) {
  const [inner, setInner] = useState(defaultValue ?? '')
  const current = value ?? inner
  const set = (v: string) => {
    if (value === undefined) setInner(v)
    onChange?.(v)
  }
  return [current, set] as const
}

type FieldProps = {
  name?: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  ariaLabel?: string
}

/** 날짜 선택 (YYYY-MM-DD). min·max도 같은 형식 */
export function DateField({ name, value, defaultValue, onChange, ariaLabel, min, max }: FieldProps & { min?: string; max?: string }) {
  const locale = useLocale()
  const tp = useTranslations('pagination')
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange)
  const { open, setOpen, ref } = usePopover()
  // 달력에 펼쳐 둔 달 (YYYY-MM)
  const [view, setView] = useState((current || todayValue()).slice(0, 7))

  const [y, m] = view.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay() // 일요일 시작
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${view}-${pad(i + 1)}`)]
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i))),
  )
  const today = todayValue()

  const shift = (delta: number) => setView(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7))

  return (
    <div className="date-field" ref={ref}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        className="date-field-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          if (!open) setView((current || today).slice(0, 7))
          setOpen(!open)
        }}
      >
        {current ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(utc(current)) : '—'}
        <CalendarDays size={13} />
      </button>
      {open && (
        <div className="date-pop" role="dialog" aria-label={ariaLabel}>
          <div className="date-pop-head">
            <button type="button" onClick={() => shift(-1)} aria-label={tp('prev')}>
              <ChevronLeft size={14} />
            </button>
            <strong>{new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(utc(`${view}-01`))}</strong>
            <button type="button" onClick={() => shift(1)} aria-label={tp('next')}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="date-grid">
            {weekdays.map((w, i) => (
              <span key={i} className="date-weekday">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d ? (
                <button
                  key={d}
                  type="button"
                  className={`date-cell${d === current ? ' is-selected' : ''}${d === today ? ' is-today' : ''}`}
                  disabled={(min != null && d < min) || (max != null && d > max)}
                  onClick={() => {
                    setCurrent(d)
                    setOpen(false)
                  }}
                >
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={`blank-${i}`} />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 월 선택 (YYYY-MM) */
export function MonthField({ name, value, defaultValue, onChange, ariaLabel }: FieldProps) {
  const locale = useLocale()
  const tp = useTranslations('pagination')
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange)
  const { open, setOpen, ref } = usePopover()
  const [year, setYear] = useState(Number((current || todayValue()).slice(0, 4)))
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })

  return (
    <div className="date-field" ref={ref}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        className="date-field-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          if (!open) setYear(Number((current || todayValue()).slice(0, 4)))
          setOpen(!open)
        }}
      >
        {current ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(utc(`${current}-01`)) : '—'}
        <CalendarDays size={13} />
      </button>
      {open && (
        <div className="date-pop" role="dialog" aria-label={ariaLabel}>
          <div className="date-pop-head">
            <button type="button" onClick={() => setYear(year - 1)} aria-label={tp('prev')}>
              <ChevronLeft size={14} />
            </button>
            <strong>{new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(utc(`${year}-01-01`))}</strong>
            <button type="button" onClick={() => setYear(year + 1)} aria-label={tp('next')}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="month-grid">
            {Array.from({ length: 12 }, (_, i) => {
              const v = `${year}-${pad(i + 1)}`
              return (
                <button
                  key={v}
                  type="button"
                  className={`date-cell${v === current ? ' is-selected' : ''}`}
                  onClick={() => {
                    setCurrent(v)
                    setOpen(false)
                  }}
                >
                  {monthName.format(utc(`${v}-01`))}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

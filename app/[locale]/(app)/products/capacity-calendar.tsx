'use client'

// 상품 빠른 보기 모달의 날짜별 정원/잔여 캘린더. 편집용 sale-calendar.tsx와 달리 읽기 전용이라
// 가볍게 새로 만든다 — 같은 CSS 클래스(sc-grid 등, product-form.css)를 그대로 쓴다.
import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { weekday } from '@/lib/products/jp-calendar'
import type { DateCapacity } from '@/lib/server/products/service'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

export function CapacityCalendar({
  month,
  capacity,
  onMonthChange,
  loading = false,
}: {
  month: string // 'YYYY-MM'
  capacity: Record<string, DateCapacity>
  onMonthChange: (month: string) => void
  loading?: boolean
}) {
  const t = useTranslations('products.capacityCalendar')
  const tp = useTranslations('products')
  const locale = useLocale()
  // 요일 이름 0=일 … 6=토 (2023-01-01이 일요일)
  const week = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))))
  }, [locale])
  const [y, m] = month.split('-').map(Number)

  const cells = useMemo(() => {
    const first = ymd(y, m - 1, 1)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return [...Array<null>(weekday(first)).fill(null), ...Array.from({ length: last }, (_, i) => ymd(y, m - 1, i + 1))]
  }, [y, m])

  function move(delta: number) {
    const total = y * 12 + (m - 1) + delta
    const ny = Math.floor(total / 12)
    const nm = ((total % 12) + 12) % 12
    onMonthChange(`${ny}-${pad(nm + 1)}`)
  }

  return (
    <div className="sc-grid-wrap" aria-busy={loading}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
        <button type="button" className="sc-nav" onClick={() => move(-1)} aria-label={tp('pkg.prevMonth')} disabled={loading}>
          ‹
        </button>
        <strong>
          {y}.{m}
        </strong>
        <button type="button" className="sc-nav" onClick={() => move(1)} aria-label={tp('pkg.nextMonth')} disabled={loading}>
          ›
        </button>
      </div>
      <div className="sc-grid">
        {week.map((w, i) => (
          <div key={i} className={`sc-week${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />
          const wd = weekday(d)
          const c = capacity[d]
          const capText = !c ? '' : !c.open ? t('closed') : c.max == null ? t('unlimited') : t('maxPeople', { count: c.max })
          const cls = ['sc-day', wd === 0 ? 'sun' : wd === 6 ? 'sat' : '', c?.open ? 'set' : ''].join(' ')
          return (
            <div key={d} className={cls} title={capText}>
              <span className="sc-num">{Number(d.slice(8))}</span>
              {capText && <span className="sc-cap">{capText}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

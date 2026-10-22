'use client'

// 취소 수수료: "출발 N일 전까지 취소하면 수수료 N%" 줄 목록 + 항상 있는 마지막 줄 "그 이후 취소·노쇼 100%".
// 줄은 일수가 큰 순서(먼 날 → 가까운 날)로 정렬한다. 입력 중에 줄이 튀지 않게, 칸에서 벗어날 때 정렬한다.

import { useTranslations } from 'next-intl'
import { newId, type CancelRule } from '@/lib/products/types'

/** 화면용 한 줄 — 서버 타입(CancelRule)엔 없는 id를 React key용으로만 붙인다 */
export type CancelRuleRow = CancelRule & { id: string }

const sortRules = (r: CancelRuleRow[]) => [...r].sort((a, b) => b.daysBefore - a.daysBefore)

export function CancelFees({ value, onChange }: { value: CancelRuleRow[]; onChange: (v: CancelRuleRow[]) => void }) {
  const t = useTranslations('products.cancelFees')
  const tp = useTranslations('products')
  const set = (id: string, patch: Partial<CancelRule>) => onChange(value.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id: string) => onChange(value.filter((x) => x.id !== id))
  const add = () => {
    // 지금 가장 가까운 줄보다 하루 더 가까운 날로 추가 (0일 전이 이미 있으면 그대로 0)
    const last = sortRules(value).at(-1)
    const days = last ? Math.max(0, last.daysBefore - 1) : 7
    onChange(sortRules([...value, { id: newId(), daysBefore: days, percent: last ? Math.min(100, last.percent) : 0 }]))
  }

  const sorted = sortRules(value)
  const dupDays = new Set(value.map((r) => r.daysBefore).filter((d, i, a) => a.indexOf(d) !== i))
  // 출발이 가까워질수록 수수료는 같거나 커야 자연스럽다
  const decreasing = sorted.some((r, i) => i > 0 && r.percent < sorted[i - 1].percent)

  return (
    <div className="cf">
      {value.map((r) => (
        <div key={r.id} className={`cf-row${dupDays.has(r.daysBefore) ? ' error' : ''}`}>
          <span className="cf-when">
            {t('departure')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={r.daysBefore}
              onChange={(e) => set(r.id, { daysBefore: Math.max(0, Number(e.target.value) || 0) })}
              onBlur={() => onChange(sortRules(value))}
              aria-label={tp('daysBeforeAriaLabel')}
            />
            {t('daysBeforeSuffix')}
          </span>
          <span className="cf-fee">
            {tp('cancelFee')}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={r.percent}
              onChange={(e) => set(r.id, { percent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
              aria-label={t('feePercent')}
            />
            %
          </span>
          <button type="button" className="proto-remove" onClick={() => remove(r.id)} aria-label={t('removeRow')}>✕</button>
        </div>
      ))}
      <div className="cf-row cf-last">
        <span className="cf-when">{t('after')}</span>
        <span className="cf-fee">
          {tp('cancelFee')} <b>100</b>%
        </span>
        <span className="cf-lock">{t('fixed')}</span>
      </div>
      {dupDays.size > 0 && <p className="cf-error">{t('dupError')}</p>}
      {!dupDays.size && decreasing && <p className="cf-warn">{t('decreasingWarn')}</p>}
      <button type="button" className="proto-add proto-add-small" onClick={add}>
        + {t('addRow')}
      </button>
    </div>
  )
}

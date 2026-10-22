// 취소 수수료 규칙 검사. CancelRule = { daysBefore, percent } — "출발 daysBefore일 전까지 취소하면 percent%"
import type { CancelRule } from '@/lib/products/types'
import { ruleChecker, type Finding } from '../types'

/** percent가 0~100 밖, daysBefore가 음수 */
export const cancelRange = ruleChecker('CANCEL_RULE_RANGE', (t) => {
  const out: Finding[] = []
  t.proposed.cancelRules.forEach((r: CancelRule, i) => {
    if (r.percent < 0 || r.percent > 100 || r.daysBefore < 0) {
      out.push({ code: 'CANCEL_RULE_RANGE', severity: 'high', source: 'rule', field: `cancelRules.${i}`, evidence: { index: i, ...r } })
    }
  })
  return out
})

/** 같은 daysBefore가 두 번 — 어느 줄이 이기는지 사람이 알 수 없다 */
export const cancelDuplicate = ruleChecker('CANCEL_RULE_DUPLICATE', (t) => {
  const seen = new Map<number, number>()
  const out: Finding[] = []
  t.proposed.cancelRules.forEach((r, i) => {
    const first = seen.get(r.daysBefore)
    if (first !== undefined) {
      out.push({ code: 'CANCEL_RULE_DUPLICATE', severity: 'medium', source: 'rule', field: `cancelRules.${i}`, evidence: { daysBefore: r.daysBefore, rows: [first, i] } })
    } else {
      seen.set(r.daysBefore, i)
    }
  })
  return out
})

/** 출발일에 가까워질수록 수수료가 싸지는 줄. 거의 항상 입력 실수다 */
export const cancelNotIncreasing = ruleChecker(
  'CANCEL_RULE_NOT_INCREASING',
  (t) => {
    const sorted = [...t.proposed.cancelRules].sort((a, b) => b.daysBefore - a.daysBefore)
    const out: Finding[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      if (cur.percent < prev.percent) {
        out.push({
          code: 'CANCEL_RULE_NOT_INCREASING',
          severity: 'medium',
          source: 'rule',
          field: 'cancelRules',
          evidence: { earlier: prev, later: cur },
        })
      }
    }
    return out
  },
  (t) => t.proposed.cancelRules.length >= 2,
)

export const cancelRules = [cancelRange, cancelDuplicate, cancelNotIncreasing]

// 변경요청 전용 — 바뀐 폭이 큰 곳을 짚는다. current가 있을 때만 돈다.
// "무엇이 바뀌었나"는 기계가 정확히 계산할 수 있다. "그 변경이 무슨 뜻인가"는 ai/ 쪽이 맡는다.
import { priceFrom } from '@/lib/products/types'
import { ruleChecker, type Finding } from '../types'

const isEdit = (t: { current: unknown }) => t.current !== null

// 대표가가 이만큼 움직이면 심사자가 한 번 보는 게 맞다
const PRICE_JUMP = 0.3

/** 대표가가 30% 넘게 오르내림 */
export const priceJump = ruleChecker(
  'PRICE_CHANGED_LARGE',
  (t) => {
    const before = priceFrom(t.current!.priceTable)
    const after = priceFrom(t.proposed.priceTable)
    if (before === null || after === null || before === 0) return []
    const rate = (after - before) / before
    if (Math.abs(rate) < PRICE_JUMP) return []
    return [
      {
        code: 'PRICE_CHANGED_LARGE',
        severity: 'high',
        source: 'rule',
        field: 'priceTable',
        evidence: { before, after, rate: Math.round(rate * 1000) / 10 },
      },
    ]
  },
  isEdit,
)

/** 취소 수수료가 느슨해짐 (같은 시점의 수수료율이 낮아지거나 줄이 사라짐) */
export const cancelRelaxed = ruleChecker(
  'CANCEL_RULE_RELAXED',
  (t) => {
    const before = t.current!.cancelRules
    const after = t.proposed.cancelRules
    const out: Finding[] = []
    for (const b of before) {
      const a = after.find((r) => r.daysBefore === b.daysBefore)
      if (!a) {
        out.push({ code: 'CANCEL_RULE_RELAXED', severity: 'medium', source: 'rule', field: 'cancelRules', evidence: { removed: b } })
      } else if (a.percent < b.percent) {
        out.push({ code: 'CANCEL_RULE_RELAXED', severity: 'medium', source: 'rule', field: 'cancelRules', evidence: { daysBefore: b.daysBefore, before: b.percent, after: a.percent } })
      }
    }
    return out
  },
  isEdit,
)

/** 사진이 있던 상품에서 사진이 전부 사라짐 */
export const imagesRemoved = ruleChecker(
  'IMAGES_ALL_REMOVED',
  (t) => {
    if (t.current!.images.length === 0 || t.proposed.images.length > 0) return []
    return [{ code: 'IMAGES_ALL_REMOVED', severity: 'medium', source: 'rule', field: 'images', evidence: { before: t.current!.images.length } }]
  },
  isEdit,
)

/** 업체가 바뀜. updateProduct는 업체를 안 바꾸므로(지난 예약·정산이 넘어간다) 들어오면 안 되는 값이다 */
export const partnerChanged = ruleChecker(
  'PARTNER_CHANGED',
  (t) => {
    if (t.current!.partnerId === t.proposed.partnerId) return []
    return [{ code: 'PARTNER_CHANGED', severity: 'high', source: 'rule', field: 'partnerId', evidence: { before: t.current!.partnerId, after: t.proposed.partnerId } }]
  },
  isEdit,
)

export const diffRules = [priceJump, cancelRelaxed, imagesRemoved, partnerChanged]

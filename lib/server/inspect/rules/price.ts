// 요금 관련 규칙 검사. 전부 산수라 Solar를 쓰지 않는다.
import type { Plan, PriceTable, Yen } from '@/lib/products/types'
import { ruleChecker, type Finding } from '../types'

const num = (v: Yen): v is number => typeof v === 'number'

/** 요금표에 실제로 적힌 단가 전부 (요금표 + 숙박 객실 기본요금) */
function allPrices(t: PriceTable): number[] {
  const fromPlans = t.plans.flatMap((p) => Object.values(p.prices).filter(num))
  const fromRooms = Object.values(t.roomPricing.base)
    .map((r) => r.price)
    .filter(num)
  return [...fromPlans, ...fromRooms]
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : ((s[mid - 1]! + s[mid]!) / 2)
}

const ADULT = /성인|대인|어른|adult/i
const CHILD = /아동|소인|어린이|child|kid/i

/** 0엔 칸. 무료 상품일 수도 있으니 경고만 */
export const priceZero = ruleChecker('PRICE_ZERO', (t) => {
  const pt = t.proposed.priceTable
  const out: Finding[] = []
  for (const plan of pt.plans) {
    for (const [catId, price] of Object.entries(plan.prices)) {
      if (price === 0) {
        const cat = pt.categories.find((c) => c.id === catId)
        out.push({
          code: 'PRICE_ZERO',
          severity: 'medium',
          source: 'rule',
          field: `priceTable.plans.${plan.id}.prices.${catId}`,
          evidence: { plan: plan.name, category: cat?.name ?? catId },
        })
      }
    }
  }
  return out
})

/** 아동 요금이 성인 요금보다 비싼 칸. 기준 이름으로 성인·아동을 찾는다 */
export const childOverAdult = ruleChecker('CHILD_PRICE_OVER_ADULT', (t) => {
  const pt = t.proposed.priceTable
  const adult = pt.categories.find((c) => ADULT.test(c.name))
  const child = pt.categories.find((c) => CHILD.test(c.name))
  if (!adult || !child) return []
  const out: Finding[] = []
  for (const plan of pt.plans) {
    const a = plan.prices[adult.id]
    const c = plan.prices[child.id]
    if (num(a) && num(c) && c > a) {
      out.push({
        code: 'CHILD_PRICE_OVER_ADULT',
        severity: 'high',
        source: 'rule',
        field: `priceTable.plans.${plan.id}.prices.${child.id}`,
        evidence: { plan: plan.name, adultName: adult.name, adult: a, childName: child.name, child: c },
      })
    }
  }
  return out
})

// 0을 하나 더 붙이면 10배가 된다. 상품 안의 다른 단가들과 견줘서 그 정도로 튀는 칸을 찾는다.
const OUTLIER_RATIO = 10

/** 같은 상품 안에서 자릿수가 튀는 단가 (0을 더 붙였거나 빠뜨린 오타) */
export const priceOutlier = ruleChecker(
  'PRICE_OUTLIER',
  (t) => {
    const pt = t.proposed.priceTable
    const prices = allPrices(pt).filter((p) => p > 0)
    const mid = median(prices)
    if (mid === null || prices.length < 3) return []
    const out: Finding[] = []
    const check = (price: number, field: string, where: Record<string, unknown>) => {
      if (price <= 0) return
      const ratio = price / mid
      if (ratio >= OUTLIER_RATIO || ratio <= 1 / OUTLIER_RATIO) {
        out.push({
          code: 'PRICE_OUTLIER',
          severity: 'high',
          source: 'rule',
          field,
          evidence: { ...where, price, median: mid, ratio: Math.round(ratio * 100) / 100 },
        })
      }
    }
    for (const plan of pt.plans as Plan[]) {
      for (const [catId, price] of Object.entries(plan.prices)) {
        if (num(price)) check(price, `priceTable.plans.${plan.id}.prices.${catId}`, { plan: plan.name, category: pt.categories.find((c) => c.id === catId)?.name ?? catId })
      }
    }
    for (const [roomId, rate] of Object.entries(pt.roomPricing.base)) {
      if (num(rate.price)) check(rate.price, `priceTable.roomPricing.base.${roomId}`, { room: pt.roomTypes.find((r) => r.id === roomId)?.name ?? roomId })
    }
    return out
  },
  // 단가가 3개는 있어야 "튄다"는 말이 성립한다
  (t) => allPrices(t.proposed.priceTable).length >= 3,
)

export const priceRules = [priceZero, childOverAdult, priceOutlier]

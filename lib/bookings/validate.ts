// TP 앱에서 받은 예약 신청 입력값을 검사하고 정리한다. 모르는 필드는 버리고 길이를 제한한다.
// Route Handler가 서비스에 넘기기 전에 꼭 거친다. (lib/inquiries/validate.ts와 같은 역할)
import { isCountryCode } from '@/lib/country'
import type { PriceBreakdown } from './types'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isDateOnly = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export type CreateBookingInput = {
  productId: string
  customerName: string
  phone?: string
  email?: string
  nationality: string // ISO 3166-1 국가코드 (KR, JP …)
  useDate: string // YYYY-MM-DD
  people: number
  amount: number
  priceBreakdown?: PriceBreakdown
  idempotencyKey: string
}

/** 요금 구성 스냅샷 — 대략적인 형태만 확인한다. 상품 요금표와 대조 검증은 안 한다(amount를 그대로 믿는 것과 같은 수준) */
function priceBreakdownFor(raw: unknown): PriceBreakdown | undefined {
  const o = obj(raw)
  const planId = str(o.planId, 20)
  const planName = str(o.planName, 80)
  if (!planId && !planName) return undefined

  const peopleByCategory = arr(o.peopleByCategory, 10)
    .map((c) => {
      const x = obj(c)
      return { categoryId: str(x.categoryId, 20), categoryName: str(x.categoryName, 40), count: Number(x.count) }
    })
    .filter((c) => c.categoryId && Number.isInteger(c.count) && c.count >= 0)

  const selectedOptions = arr(o.selectedOptions, 20)
    .map((s) => {
      const x = obj(s)
      return { label: str(x.label, 80), amount: Number(x.amount) }
    })
    .filter((s) => s.label && Number.isFinite(s.amount))

  return { planId, planName, peopleByCategory, selectedOptions }
}

export type ParseResult = { ok: true; value: CreateBookingInput } | { ok: false; error: 'required' }

/** TP 앱이 보낸 예약 신청을 검사한다. productId가 실제 노출중 상품인지는 서비스(DB)에서 따로 확인한다.
 *  idempotencyKey는 앱이 요청 하나당 한 번만 만들어서 재시도에도 그대로 다시 보내는 값 — 같은 요청이
 *  두 번 들어와도 예약이 중복 생성되지 않게 막는 데 쓴다. */
export function parseCreateBookingInput(raw: unknown): ParseResult {
  const o = obj(raw)
  const productId = str(o.productId, 40)
  const customerName = str(o.customerName, 80)
  const phone = str(o.phone, 40)
  const email = str(o.email, 120)
  const nationality = str(o.nationality, 10).toUpperCase()
  const idempotencyKey = str(o.idempotencyKey, 100)
  const people = Number(o.people)
  const amount = Number(o.amount)
  const priceBreakdown = priceBreakdownFor(o.priceBreakdown)

  if (!productId || !customerName || !nationality || !idempotencyKey || !isDateOnly(o.useDate)) return { ok: false, error: 'required' }
  if (!isCountryCode(nationality)) return { ok: false, error: 'required' }
  if (!Number.isInteger(people) || people < 1) return { ok: false, error: 'required' }
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, error: 'required' }

  return {
    ok: true,
    value: {
      productId,
      customerName,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      nationality,
      useDate: o.useDate as string,
      people,
      amount,
      ...(priceBreakdown ? { priceBreakdown } : {}),
      idempotencyKey,
    },
  }
}

// 소개서에서 뽑은 평면 JSON → 등록 화면이 바로 쓸 수 있는 모양.
// 추출 모델에 id를 만들게 하지 않는다 — Plan.prices가 category.id를 키로 써서, 여기서 newId()로 이어 붙인다.
import { newId, type CancelRule, type PriceTable } from './types'
import type { DefaultTitleKind } from './default-titles'
import { cancelRulesFor, priceTableFor } from './validate'

/** BE(POST /api/v1/products/extract)가 소개서에서 뽑아 준 값. id가 없는 평면 구조 — 기준은 이름으로 가리킨다.
 *  요금표는 칸 단위(plan × category)로 펴서 온다 — Universal Extraction이 배열 안의 배열을 받지 않는다.
 *  모양(스키마)은 BE resources/upstage/product-extract-schema.json */
export type ExtractedProduct = {
  productName: string
  description: string
  priceRows: { plan: string; category: string; yen: number | null }[]
  priceNote: string
  cancelRules: { daysBefore: number; percent: number }[]
  sections: { kind: string; title: string; text: string }[]
}

export type DraftSection = { kind: DefaultTitleKind | 'other'; title: string; text: string }

export type ProductDraft = {
  name: string
  description: string
  priceTable: PriceTable
  cancelRules: CancelRule[]
  sections: DraftSection[]
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** 이름 대조용. 공백·괄호를 지우고 소문자로 — "성인 (만12세~)"과 "성인"을 같게 본다 */
const key = (s: string) => s.replace(/[\s()（）]/g, '').toLowerCase()

/** 칸 목록(plan × category)을 요금표 모양으로 되세운다. 행·열 순서는 문서에 나온 순서를 따른다 */
export function toProductDraft(raw: ExtractedProduct): ProductDraft {
  const rows = (Array.isArray(raw.priceRows) ? raw.priceRows : [])
    .map((r) => ({ plan: text(r?.plan), category: text(r?.category), yen: typeof r?.yen === 'number' ? r.yen : null }))
    .filter((r) => r.category || r.plan)

  // 같은 이름은 한 번만, 처음 나온 순서대로
  const pick = (of: 'plan' | 'category') => {
    const seen = new Map<string, string>()
    for (const r of rows) if (r[of] && !seen.has(key(r[of]))) seen.set(key(r[of]), r[of])
    return seen
  }
  const categoryNames = pick('category')
  const planNames = pick('plan')

  const categories = [...categoryNames.values()].map((name) => ({ id: newId(), name }))
  const categoryId = new Map([...categoryNames.keys()].map((k, i) => [k, categories[i].id]))

  const plans = [...planNames.entries()].map(([planKey, name]) => {
    const prices: Record<string, number | null> = {}
    for (const r of rows) {
      if (key(r.plan) !== planKey) continue
      const id = categoryId.get(key(r.category))
      if (id) prices[id] = r.yen
    }
    return { id: newId(), name, prices }
  })

  return {
    name: text(raw.productName),
    description: text(raw.description),
    // 범위 검사·전각 숫자 변환·빈 줄 정리는 기존 파서가 한다
    priceTable: priceTableFor({ categories, plans, priceText: text(raw.priceNote) }),
    cancelRules: cancelRulesFor(raw.cancelRules),
    sections: sectionsFor(raw.sections),
  }
}

/** 상세 섹션. 화면에 이미 있는 칸(일정표·프로그램·교통·숙박)에 들어갈 것만 남긴다.
 *  문서의 소제목을 그대로 섹션으로 만들면 "【상품지에 대해】" 같은 소개 글이 추가 섹션으로 쌓여
 *  상품 설명과 중복된다 — 그런 건 버리고 사람이 직접 쓰게 둔다 */
const SECTION_KINDS: DraftSection['kind'][] = ['itinerary', 'program', 'transport', 'lodging']

function sectionsFor(raw: unknown): DraftSection[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : [])
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>
      const kind = SECTION_KINDS.find((k) => k === text(o.kind))
      return kind ? { kind, title: text(o.title).slice(0, 60), text: text(o.text).slice(0, 4000) } : null
    })
    .filter((s): s is DraftSection => !!s?.text)
    // 같은 종류가 여러 번 오면 첫 번째만 — 화면에 그 칸이 하나뿐이다
    .filter((s) => !seen.has(s.kind) && (seen.add(s.kind), true))
}

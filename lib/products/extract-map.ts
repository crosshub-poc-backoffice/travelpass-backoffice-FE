// 소개서에서 뽑은 평면 JSON → 등록 화면이 바로 쓸 수 있는 모양.
// 추출 모델에 id를 만들게 하지 않는다 — Plan.prices가 category.id를 키로 써서, 여기서 newId()로 이어 붙인다.
import { newId, type CancelRule, type PriceTable } from './types'
import type { DefaultTitleKind } from './default-titles'
import { cancelRulesFor, priceTableFor } from './validate'
import { routing } from '@/i18n/routing'

/** BE(POST /api/v1/products/extract · extract-url)가 소개서·상품 페이지에서 뽑아 준 값. id가 없는 평면 구조 — 기준은 이름으로 가리킨다.
 *  요금표는 칸 단위(plan × category)로 펴서 온다. 근거(evidence) 검산은 BE가 끝내고 값만 보낸다.
 *  설명(description)은 BE가 요약 + 핵심 포인트 목록으로 조립해 보낸다. 모양은 BE ProductExtractService.toFlat */
export type ExtractedProduct = {
  /** 문서 언어 (ja, ko, en …). 모르면 '' */
  sourceLocale?: string
  productName: string
  description: string
  priceRows: { plan: string; category: string; yen: number | null }[]
  priceNote: string
  cancelRules: { daysBefore: number; percent: number }[]
  sections: { kind: string; title: string; text: string }[]
  /** 판매 기간 YYYY-MM-DD. 문서에 없으면 '' */
  saleStart?: string
  saleEnd?: string
  /** 문서는 소인(어린이) 요금을 말하는데 요금표에 그 열이 없다 — BE 가 문서를 보고 판단 */
  missingChildPrice?: boolean
  /** 상품 내용인데 어느 칸에도 쓰이지 않은 문서 블록 — BE 누락 검사(블록 라벨 + 앞부분 원문) */
  uncoveredBlocks?: { label?: string; snippet?: string }[]
}

export type DraftSection = { kind: DefaultTitleKind | 'other'; title: string; text: string }

export type ProductDraft = {
  name: string
  description: string
  priceTable: PriceTable
  cancelRules: CancelRule[]
  sections: DraftSection[]
  /** 원문 언어. 저장할 때 같이 보내면 번역 전 언어 감지 호출을 건너뛴다 */
  sourceLocale: string | null
  /** 판매 기간. 둘 다 있고 순서가 맞을 때만 */
  saleStart: string | null
  saleEnd: string | null
  missingChildPrice: boolean
  uncoveredBlocks: DraftBlock[]
}

/** BE 블록 라벨 중 사람에게 보여 줄 것 (title·intro·irrelevant 는 누락 검사 대상이 아니다) */
export const BLOCK_LABELS = ['price', 'adjustment', 'sale_period', 'itinerary', 'program', 'transport', 'lodging', 'included', 'meals', 'guide', 'policy', 'notice'] as const
export type BlockLabel = (typeof BLOCK_LABELS)[number]
export type DraftBlock = { label: BlockLabel; snippet: string }

/** 채운 뒤에도 사람이 확인해야 할 빈칸. 다시 읽게 하지 않고(비용·결과가 같을 가능성) 무엇이 비었는지만 짚어 준다 */
export type DraftGap =
  | { kind: 'price'; plan: string; category: string }
  | { kind: 'noPrice' }
  | { kind: 'childPrice' }
  | { kind: 'cancelRules' }
  | { kind: 'salePeriod' }
  | { kind: 'block'; label: BlockLabel; snippet: string }

export function draftGaps(d: ProductDraft): DraftGap[] {
  const gaps: DraftGap[] = []
  const { plans, categories } = d.priceTable
  if (!plans.length) gaps.push({ kind: 'noPrice' })
  for (const plan of plans) {
    for (const c of categories) {
      if (plan.prices[c.id] == null) gaps.push({ kind: 'price', plan: plan.name, category: c.name })
    }
  }
  if (d.missingChildPrice) gaps.push({ kind: 'childPrice' })
  if (!d.cancelRules.length) gaps.push({ kind: 'cancelRules' })
  if (!d.saleStart) gaps.push({ kind: 'salePeriod' })
  for (const b of d.uncoveredBlocks) gaps.push({ kind: 'block', ...b })
  return gaps
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
    sourceLocale: (routing.locales as readonly string[]).includes(text(raw.sourceLocale)) ? text(raw.sourceLocale) : null,
    ...salePeriod(text(raw.saleStart), text(raw.saleEnd)),
    missingChildPrice: raw.missingChildPrice === true,
    uncoveredBlocks: (Array.isArray(raw.uncoveredBlocks) ? raw.uncoveredBlocks : []).flatMap((b) => {
      const label = text(b?.label)
      return (BLOCK_LABELS as readonly string[]).includes(label) ? [{ label: label as BlockLabel, snippet: text(b?.snippet) }] : []
    }),
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function salePeriod(start: string, end: string): { saleStart: string | null; saleEnd: string | null } {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || end < start) return { saleStart: null, saleEnd: null }
  return { saleStart: start, saleEnd: end }
}

/** 상세 섹션. 일정표·프로그램·교통·숙박은 종류마다 하나, 그 밖의 안내(포함 사항·식사·가이드 등)는 other 로 제목을 달고 여러 개.
 *  other 는 제목이 있어야 한다 — 제목 없는 덩어리는 화면에서 무엇인지 알 수 없다.
 *  여행지 소개 글은 서버가 상품 설명으로 보내고 섹션으로 만들지 않는다 (product-solar-schema.json) */
const SECTION_KINDS: DraftSection['kind'][] = ['itinerary', 'program', 'transport', 'lodging', 'other']
const MAX_OTHER_SECTIONS = 5

function sectionsFor(raw: unknown): DraftSection[] {
  const seen = new Set<string>()
  let others = 0
  return (Array.isArray(raw) ? raw : [])
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>
      const kind = SECTION_KINDS.find((k) => k === text(o.kind))
      return kind ? { kind, title: text(o.title).slice(0, 60), text: text(o.text).slice(0, 4000) } : null
    })
    .filter((s): s is DraftSection => !!s?.text && (s.kind !== 'other' || !!s.title))
    // 같은 종류(other 는 같은 제목)가 여러 번 오면 첫 번째만
    .filter((s) => {
      const key = s.kind === 'other' ? `other:${s.title}` : s.kind
      if (seen.has(key)) return false
      seen.add(key)
      return s.kind !== 'other' || ++others <= MAX_OTHER_SECTIONS
    })
}

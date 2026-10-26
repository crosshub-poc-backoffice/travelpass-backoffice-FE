import 'server-only'
import { routing, type Locale } from '@/i18n/routing'
import { backend, BackendError, qs, seg } from '@/lib/api/backend'
import { localizeProduct, sourceMap, type TextEntry } from '@/lib/products/translation'

// 상품 정보 번역. 원문은 Product 그대로, 언어별 번역은 ProductTranslation에 키 → 글로 둔다.
// 번역을 만들고 고치는 것(자동 번역·다시 번역·사람이 고친 번역 저장·원문 언어 바로잡기)은 BE(/api/v1/products/{id}/translations)가 한다
// — 상품을 저장하면 BE 가 바뀐 칸만 백그라운드로 다시 번역하고, 모든 언어에 빈 칸이 없어야 노출(live)할 수 있다는 규칙도 BE 가 본다.
// 조회(번역 화면·보는 사람 언어로 바꾸기)도 BE 에서 받는다 — 목록 번역 상태는 BE 상품 목록이 행마다 같이 준다.

type Json = Record<string, string>

const isLocale = (v: string): v is Locale => (routing.locales as readonly string[]).includes(v)

/** BE 번역 원본 한 줄 (상품·언어 하나) */
type BeTranslationRow = { productId: string; texts: Json; sources: Json }

/** 상품들의 한 언어 번역 원본. BE 가 범위 밖 상품은 뺀다. 한 번에 200개씩 */
async function fetchTranslationRows(productIds: string[], locale: string): Promise<BeTranslationRow[]> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0 || !isLocale(locale)) return []
  const out: BeTranslationRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(await backend.get<BeTranslationRow[]>(`/api/v1/products/translations${qs({ locale, ids: ids.slice(i, i + 200).join(',') })}`)))
  }
  return out
}

export type LocaleTranslation = {
  locale: Locale
  /** none = 아직 번역 없음 */
  state: 'none' | 'auto' | 'reviewed'
  texts: Json
  missing: string[]
  stale: string[]
  /** 원문 변경 칸의 번역할 때 원문 — 무엇이 바뀌었는지 보여준다 */
  previousSources: Json
  updatedAt: string | null
}

export type ProductTranslations = {
  id: string
  name: string
  sourceLocale: string | null
  entries: TextEntry[]
  /** blocks[i].title — 번역 화면에서 블록 묶음 이름으로 쓴다 */
  blockTitles: string[]
  locales: LocaleTranslation[]
}

/** 번역 화면. 아직 번역한 적 없는 상품(시드·기존 상품)은 BE 가 원문 언어부터 정한다. 범위 밖·없는 상품이면 null */
export async function getProductTranslations(productId: string, _partnerIds: string[]): Promise<ProductTranslations | null> {
  try {
    return await backend.get<ProductTranslations>(`/api/v1/products/${seg(productId)}/translations`)
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return null
    throw e
  }
}

type Result = { ok: true } | { ok: false; error: 'notFound' | 'translateFailed' | 'translationIncomplete' }


/** BE 번역 쓰기 호출. 실패는 BE 가 주는 {code}(FE 에러 키와 같은 이름)로 */
async function call(run: () => Promise<unknown>): Promise<Result> {
  try {
    await run()
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.code === 'translateFailed' || e.code === 'translationIncomplete') return { ok: false, error: e.code }
      return { ok: false, error: 'notFound' }
    }
    throw e
  }
}

/** 그 언어의 모든 칸을 다시 번역 (번역 화면의 "다시 번역" 버튼). 사람이 고친 번역도 덮어쓴다 — 화면에서 확인창을 띄운다 */
export async function retranslate(_userId: string, productId: string, locale: string, _partnerIds: string[]): Promise<Result> {
  if (!isLocale(locale)) return { ok: false, error: 'notFound' }
  return call(() => backend.post(`/api/v1/products/${seg(productId)}/translations/${encodeURIComponent(locale)}/retranslate`))
}

/** 사람이 고친 번역 저장. edits = 고친 칸만 (키 → 글). review면 검수 완료로 — 빈 칸이 있으면 안 되고, 원문 변경 칸도 확인한 걸로 본다 */
export async function saveTranslation(
  _userId: string,
  productId: string,
  locale: string,
  edits: Json,
  review: boolean,
  _partnerIds: string[],
): Promise<Result> {
  if (!isLocale(locale)) return { ok: false, error: 'notFound' }
  return call(() => backend.put(`/api/v1/products/${seg(productId)}/translations/${encodeURIComponent(locale)}`, { edits, review }))
}

/** 원문 언어를 바로잡는다. 그 언어의 번역은 지우고, 원래 원문 언어로의 번역은 BE 가 이어서 백그라운드로 채운다 */
export async function changeSourceLocale(_userId: string, productId: string, locale: string, _partnerIds: string[]): Promise<Result> {
  if (!isLocale(locale)) return { ok: false, error: 'notFound' }
  return call(() => backend.put(`/api/v1/products/${seg(productId)}/source-locale`, { locale }))
}

/** 키 없이 글만 남아 있는 값(예약에 저장된 상품명·플랜·옵션명 스냅샷)을 보는 사람 언어로 바꾸는 함수를 만든다.
 *  번역할 때의 원문(sources)과 글이 같으면 그 번역문을 쓰고, " · "로 이어 붙인 글은 조각마다 찾는다.
 *  못 찾으면(원문 언어로 보는 중·번역 전·예약 뒤에 원문이 바뀜) 원문 그대로 */
export async function productTextLocalizer(productIds: string[], locale: string): Promise<(productId: string, text: string) => string> {
  const rows = await fetchTranslationRows(productIds, locale)
  const byProduct = new Map<string, Map<string, string>>()
  for (const r of rows) {
    const texts = r.texts
    const map = new Map<string, string>()
    for (const [key, source] of Object.entries(r.sources)) if (source && texts[key]) map.set(source, texts[key])
    byProduct.set(r.productId, map)
  }
  return (productId, text) => {
    const map = byProduct.get(productId)
    if (!map || !text) return text
    return map.get(text) ?? text.split(' · ').map((part) => map.get(part) ?? part).join(' · ')
  }
}

/** 상품명을 보는 사람 언어로 (번역의 name 칸. 원문이 바뀌어 예전 번역이어도 그대로 쓴다). ai: 원문 대신 번역문(AI 번역)을 보여 주는 중이라 화면에 ✨ 표시 */
export async function productNameLocalizer(productIds: string[], locale: string): Promise<(productId: string, name: string) => { name: string; ai: boolean }> {
  const rows = await fetchTranslationRows(productIds, locale)
  const names = new Map(rows.map((r) => [r.productId, r.texts.name?.trim()]))
  return (productId, name) => {
    const localized = names.get(productId) || name
    return { name: localized, ai: localized !== name }
  }
}

/** 상품 전체(빠른 보기 등)를 보는 사람 언어로. 원문이 바뀌어 번역이 예전 것이어도 번역문을 보여 준다 (원문보다 읽을 수 있는 게 낫다). 번역이 빈 칸만 원문. nameAi: 상품명이 번역문인지 */
export async function localizeProductFor<T extends Parameters<typeof sourceMap>[0] & { id: string }>(p: T, locale: string): Promise<{ product: T; nameAi: boolean }> {
  const [row] = await fetchTranslationRows([p.id], locale)
  if (!row) return { product: p, nameAi: false }
  const product = localizeProduct(p, row.texts)
  return { product, nameAi: product.name !== p.name }
}

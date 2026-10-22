import 'server-only'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { routing, type Locale } from '@/i18n/routing'
import { detectLanguage, translateMany, TranslateError } from '@/lib/api/translate.server'
import { DEFAULT_TITLES, defaultTitleKind } from '@/lib/products/default-titles'
import { localizeProduct, outdatedKeys, productTexts, sourceMap, targetLocales, type TextEntry } from '@/lib/products/translation'
import { blocksFor, priceTableFor } from '@/lib/products/validate'
import type { TranslationSummary } from '@/lib/products/types'
import { audit } from '@/lib/server/audit/service'

// 상품 정보 번역. 원문은 Product 그대로, 언어별 번역은 ProductTranslation에 키 → 글로 둔다.
// - 상품을 저장하면 모든 언어에서 바뀐 칸만 자동으로 다시 번역한다 (syncProductTranslations). 안 바뀐 칸은 고쳐 둔 번역을 그대로 둔다
// - 다시 번역한 언어는 검수 전으로 돌아간다 (새 기계 번역을 다시 확인하라는 뜻)
// - 모든 언어에 빈 칸이 없어야 노출(live)할 수 있다 (translationsComplete). 검수 완료는 필수가 아니다

type Json = Record<string, string>
const asMap = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})

/** Google 감지 결과를 화면 언어 코드로. zh는 간체로 본다 */
function normalizeLocale(code: string | null): string | null {
  if (!code) return null
  if (code === 'zh') return 'zh-CN'
  return code
}

async function loadProduct(id: string, partnerIds?: string[]) {
  const p = await prisma.product.findFirst({
    where: { id, ...(partnerIds ? { partnerId: { in: partnerIds } } : {}) },
    select: { id: true, name: true, description: true, priceTable: true, blocks: true, sourceLocale: true, partnerId: true, status: true },
  })
  if (!p) return null
  return { ...p, priceTable: priceTableFor(p.priceTable), blocks: blocksFor(p.blocks) }
}
type LoadedProduct = NonNullable<Awaited<ReturnType<typeof loadProduct>>>

/** 원문 언어. 비어 있으면 상품명·소개로 감지해서 저장한다 */
async function ensureSourceLocale(p: LoadedProduct): Promise<string | null> {
  if (p.sourceLocale) return p.sourceLocale
  const detected = normalizeLocale(await detectLanguage(`${p.name}\n${p.description}`))
  if (detected) await prisma.product.update({ where: { id: p.id }, data: { sourceLocale: detected } })
  return detected
}

/** 기본 섹션 제목·금액 열 이름("일정표", "금액" …)이면 번역 API 없이 표(lib/products/default-titles.ts)의 그 언어 값 */
function tableTitle(source: string, locale: Locale): string | null {
  const kind = defaultTitleKind(source)
  return kind ? DEFAULT_TITLES[locale][kind] : null
}

/** 한 언어의 keys 칸을 번역해 저장. 기본 제목은 표에서, 나머지는 번역 API로. 원문에서 사라진 칸은 지운다. 번역한 언어는 검수 전으로 돌아간다 */
async function translateKeys(p: LoadedProduct, source: string | null, locale: Locale, keys: string[]) {
  const current = sourceMap(p)
  const row = await prisma.productTranslation.findUnique({ where: { productId_locale: { productId: p.id, locale } } })
  const texts = asMap(row?.texts)
  const sources = asMap(row?.sources)

  const apiKeys = keys.filter((k) => tableTitle(current[k], locale) === null)
  const translated = await translateMany(apiKeys.map((k) => current[k]), locale, source)
  apiKeys.forEach((k, i) => {
    texts[k] = translated[i]
  })
  for (const k of keys) {
    texts[k] = tableTitle(current[k], locale) ?? texts[k]
    sources[k] = current[k]
  }
  for (const k of Object.keys(texts)) if (!(k in current)) delete texts[k]
  for (const k of Object.keys(sources)) if (!(k in current)) delete sources[k]

  const data = { texts: texts as Prisma.InputJsonValue, sources: sources as Prisma.InputJsonValue, reviewed: false }
  await prisma.productTranslation.upsert({
    where: { productId_locale: { productId: p.id, locale } },
    create: { productId: p.id, locale, ...data },
    update: data,
  })
}

/** 저장 후 자동 번역. 모든 언어에서 비었거나 원문이 바뀐 칸만 번역한다 (검수 완료 언어도 — 다시 번역하면 검수 전으로 돌아간다). 실패해도 저장은 이미 끝났으니 로그만 */
export async function syncProductTranslations(productId: string) {
  try {
    const p = await loadProduct(productId)
    if (!p || p.status === 'draft') return
    const source = await ensureSourceLocale(p)
    if (source) await prisma.productTranslation.deleteMany({ where: { productId, locale: source } })

    const current = sourceMap(p)
    const rows = await prisma.productTranslation.findMany({ where: { productId } })
    for (const locale of targetLocales(source)) {
      const row = rows.find((r) => r.locale === locale)
      const { missing, stale } = outdatedKeys(current, asMap(row?.sources), asMap(row?.texts))
      const removed = Object.keys(asMap(row?.texts)).some((k) => !(k in current))
      if (missing.length + stale.length === 0 && !removed && row) continue
      await translateKeys(p, source, locale, [...missing, ...stale])
    }
  } catch (err) {
    console.error(`상품 자동 번역 실패 (${productId})`, err)
  }
}

/** 노출(live) 가능한지: 원문 언어를 뺀 모든 언어에 빈 칸 없이 번역이 있어야 한다. 검수 완료는 필요 없다 */
export async function translationsComplete(productId: string): Promise<boolean> {
  const p = await loadProduct(productId)
  if (!p?.sourceLocale) return false
  const current = sourceMap(p)
  const rows = await prisma.productTranslation.findMany({ where: { productId } })
  return targetLocales(p.sourceLocale).every((locale) => {
    const row = rows.find((r) => r.locale === locale)
    return !!row && outdatedKeys(current, asMap(row.sources), asMap(row.texts)).missing.length === 0
  })
}

/** 목록에 보여줄 상품 하나의 번역 상태 (언어 5개를 한 칸으로 합친다) */
export function translationSummary(p: {
  status: string
  sourceLocale: string | null
  name: string
  description: string
  priceTable: unknown
  blocks: unknown
  translations: { locale: string; texts: unknown; sources: unknown; reviewed: boolean }[]
}): TranslationSummary | null {
  if (p.status === 'draft') return null
  const current = sourceMap({ name: p.name, description: p.description, priceTable: priceTableFor(p.priceTable), blocks: blocksFor(p.blocks) })
  const rows = targetLocales(p.sourceLocale)
    .map((l) => p.translations.find((t) => t.locale === l))
    .filter((r): r is NonNullable<typeof r> => !!r)
  // 빈 칸이 있는 언어가 하나라도 있으면(번역 실패·중간에 멈춤) "번역 전" — 이 상태로는 노출할 수 없다 (translationsComplete와 같은 기준)
  const complete =
    !!p.sourceLocale &&
    rows.length === targetLocales(p.sourceLocale).length &&
    rows.every((r) => outdatedKeys(current, asMap(r.sources), asMap(r.texts)).missing.length === 0)
  if (!complete) return { state: 'none' }
  const allReviewed = rows.length === targetLocales(p.sourceLocale).length && rows.every((r) => r.reviewed)
  return { state: allReviewed ? 'reviewed' : 'auto' }
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

export async function getProductTranslations(productId: string, partnerIds: string[]): Promise<ProductTranslations | null> {
  const p = await loadProduct(productId, partnerIds)
  if (!p) return null
  // 아직 번역한 적 없는 상품(시드·기존 상품)은 여기서 원문 언어부터 정한다. 감지 실패면 null로 두고 화면에서 고르게
  const sourceLocale = await ensureSourceLocale(p).catch(() => null)
  const current = sourceMap(p)
  const rows = await prisma.productTranslation.findMany({ where: { productId } })
  return {
    id: p.id,
    name: p.name,
    sourceLocale,
    entries: productTexts(p),
    blockTitles: p.blocks.map((b) => b.title),
    locales: targetLocales(sourceLocale).map((locale) => {
      const row = rows.find((r) => r.locale === locale)
      const texts = asMap(row?.texts)
      const sources = asMap(row?.sources)
      const { missing, stale } = outdatedKeys(current, sources, texts)
      return {
        locale,
        state: !row ? 'none' : row.reviewed ? 'reviewed' : 'auto',
        texts,
        missing,
        stale,
        previousSources: Object.fromEntries(stale.map((k) => [k, sources[k] ?? ''])),
        updatedAt: row?.updatedAt.toISOString() ?? null,
      }
    }),
  }
}

type Result = { ok: true } | { ok: false; error: 'notFound' | 'translateFailed' | 'translationIncomplete' }

const isLocale = (v: string): v is Locale => (routing.locales as readonly string[]).includes(v)

/** 그 언어의 모든 칸을 다시 번역 (번역 화면의 "다시 번역" 버튼). 다시 번역한 언어는 검수 전으로 */
export async function retranslate(userId: string, productId: string, locale: string, partnerIds: string[]): Promise<Result> {
  const p = await loadProduct(productId, partnerIds)
  if (!p || !isLocale(locale)) return { ok: false, error: 'notFound' }
  try {
    const source = await ensureSourceLocale(p)
    if (locale === source) return { ok: false, error: 'notFound' }
    // 모든 칸을 새로 번역한다 (사람이 고친 번역도 덮어쓴다 — 화면에서 확인창을 띄운다)
    await translateKeys(p, source, locale, Object.keys(sourceMap(p)))
  } catch (err) {
    if (err instanceof TranslateError) return { ok: false, error: 'translateFailed' }
    throw err
  }
  await audit({ userId, action: 'product_translation', partnerId: p.partnerId, targetId: productId, targetName: p.name, detail: { locale: [null, locale] } })
  return { ok: true }
}

/** 사람이 고친 번역 저장. edits = 고친 칸만 (키 → 글). review면 검수 완료로 — 빈 칸이 있으면 안 되고, 원문 변경 칸도 확인한 걸로 본다 */
export async function saveTranslation(
  userId: string,
  productId: string,
  locale: string,
  edits: Json,
  review: boolean,
  partnerIds: string[],
): Promise<Result> {
  const p = await loadProduct(productId, partnerIds)
  if (!p || !isLocale(locale) || locale === p.sourceLocale) return { ok: false, error: 'notFound' }
  const current = sourceMap(p)
  const row = await prisma.productTranslation.findUnique({ where: { productId_locale: { productId, locale } } })
  const texts = asMap(row?.texts)
  const sources = asMap(row?.sources)

  for (const [k, v] of Object.entries(edits)) {
    if (!(k in current) || typeof v !== 'string') continue
    texts[k] = v.trim()
    sources[k] = current[k]
  }
  if (review) {
    if (Object.keys(current).some((k) => !texts[k]?.trim())) return { ok: false, error: 'translationIncomplete' }
    for (const k of Object.keys(current)) sources[k] = current[k]
  }

  const reviewed = review || (row?.reviewed ?? false)
  const data = { texts: texts as Prisma.InputJsonValue, sources: sources as Prisma.InputJsonValue, reviewed }
  await prisma.$transaction([
    prisma.productTranslation.upsert({
      where: { productId_locale: { productId, locale } },
      create: { productId, locale, ...data },
      update: data,
    }),
    audit({
      userId,
      action: 'product_translation',
      partnerId: p.partnerId,
      targetId: productId,
      targetName: p.name,
      detail: { locale: [null, locale], ...(row?.reviewed !== reviewed ? { reviewed: [row?.reviewed ?? false, reviewed] } : {}) },
    }),
  ])
  return { ok: true }
}

/** 원문 언어를 바로잡는다. 그 언어의 번역은 지우고, 원래 원문 언어로의 번역은 다음 자동 번역이 채운다 */
export async function changeSourceLocale(userId: string, productId: string, locale: string, partnerIds: string[]): Promise<Result> {
  const p = await loadProduct(productId, partnerIds)
  if (!p || !isLocale(locale)) return { ok: false, error: 'notFound' }
  await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data: { sourceLocale: locale } }),
    prisma.productTranslation.deleteMany({ where: { productId, locale } }),
    audit({ userId, action: 'product_translation', partnerId: p.partnerId, targetId: productId, targetName: p.name, detail: { sourceLocale: [p.sourceLocale, locale] } }),
  ])
  after(() => syncProductTranslations(productId))
  return { ok: true }
}

/** 키 없이 글만 남아 있는 값(예약에 저장된 상품명·플랜·옵션명 스냅샷)을 보는 사람 언어로 바꾸는 함수를 만든다.
 *  번역할 때의 원문(sources)과 글이 같으면 그 번역문을 쓰고, " · "로 이어 붙인 글은 조각마다 찾는다.
 *  못 찾으면(원문 언어로 보는 중·번역 전·예약 뒤에 원문이 바뀜) 원문 그대로 */
export async function productTextLocalizer(productIds: string[], locale: string): Promise<(productId: string, text: string) => string> {
  const rows = productIds.length
    ? await prisma.productTranslation.findMany({ where: { productId: { in: [...new Set(productIds)] }, locale }, select: { productId: true, texts: true, sources: true } })
    : []
  const byProduct = new Map<string, Map<string, string>>()
  for (const r of rows) {
    const texts = asMap(r.texts)
    const map = new Map<string, string>()
    for (const [key, source] of Object.entries(asMap(r.sources))) if (source && texts[key]) map.set(source, texts[key])
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
  const rows = productIds.length
    ? await prisma.productTranslation.findMany({ where: { productId: { in: [...new Set(productIds)] }, locale }, select: { productId: true, texts: true } })
    : []
  const names = new Map(rows.map((r) => [r.productId, asMap(r.texts).name?.trim()]))
  return (productId, name) => {
    const localized = names.get(productId) || name
    return { name: localized, ai: localized !== name }
  }
}

/** 상품명 검색 조건 — 원문 상품명이나 어느 언어든 번역된 상품명에 keyword가 들어 있으면 */
export function productNameSearch(keyword: string): Prisma.ProductWhereInput {
  return {
    OR: [
      { name: { contains: keyword, mode: 'insensitive' } },
      { translations: { some: { texts: { path: ['name'], string_contains: keyword } } } },
    ],
  }
}

/** 상품 전체(빠른 보기 등)를 보는 사람 언어로. 원문이 바뀌어 번역이 예전 것이어도 번역문을 보여 준다 (원문보다 읽을 수 있는 게 낫다). 번역이 빈 칸만 원문. nameAi: 상품명이 번역문인지 */
export async function localizeProductFor<T extends Parameters<typeof sourceMap>[0] & { id: string }>(p: T, locale: string): Promise<{ product: T; nameAi: boolean }> {
  const row = await prisma.productTranslation.findUnique({ where: { productId_locale: { productId: p.id, locale } }, select: { texts: true, sources: true } })
  if (!row) return { product: p, nameAi: false }
  const product = localizeProduct(p, asMap(row.texts))
  return { product, nameAi: product.name !== p.name }
}

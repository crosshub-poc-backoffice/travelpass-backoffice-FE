// 상품 번역: 번역할 글을 키로 뽑고, 번역문을 다시 상품 모양에 끼워 넣는다. (DB 접근 없음 — 클라이언트에서도 import 가능)
// 키는 블록·플랜 등의 id로 만들어서, 순서를 바꾸거나 줄을 추가해도 기존 번역이 제자리를 찾는다.

import { routing, type Locale } from '@/i18n/routing'
import type { Block, PriceTable, ProductInput } from './types'

/** 번역 화면의 행 이름(messages productTranslation.field.<field>) */
export type TextField =
  | 'name'
  | 'description'
  | 'priceTitle'
  | 'priceText'
  | 'category'
  | 'plan'
  | 'room'
  | 'blockTitle'
  | 'blockText'
  | 'groupTitle'
  | 'column'
  | 'option'
  | 'choice'
  | 'choiceValue'

/** section: 'basic' | 'price' | 블록 순서(0부터) — 번역 화면에서 묶어 보여주는 단위 */
export type TextEntry = { key: string; section: 'basic' | 'price' | number; field: TextField; source: string }

type Translatable = Pick<ProductInput, 'name' | 'description' | 'priceTable' | 'blocks'>

/** 번역할 글 전부. 빈 칸은 뺀다 */
export function productTexts(p: Translatable): TextEntry[] {
  const out: TextEntry[] = []
  const add = (key: string, section: TextEntry['section'], field: TextField, source: string) => {
    if (source.trim()) out.push({ key, section, field, source })
  }

  add('name', 'basic', 'name', p.name)
  add('description', 'basic', 'description', p.description)

  const pt = p.priceTable
  add('pt.title', 'price', 'priceTitle', pt.title)
  // 숙박은 요금 기준·플랜 대신 객실 타입을 쓴다. 숙박의 categories는 읽을 때마다 새 id로 채워지는 기본값(성인/아동)이라 넣으면 매번 "새 칸"이 된다
  if (pt.roomTypes.length === 0) {
    pt.categories.forEach((c) => add(`pt.cat.${c.id}`, 'price', 'category', c.name))
    pt.plans.forEach((pl) => add(`pt.plan.${pl.id}`, 'price', 'plan', pl.name))
  }
  pt.roomTypes.forEach((r) => add(`pt.room.${r.id}`, 'price', 'room', r.name))
  add('pt.text', 'price', 'priceText', pt.priceText)

  p.blocks.forEach((b, i) => {
    const k = `b.${b.id}`
    add(`${k}.title`, i, 'blockTitle', b.title)
    add(`${k}.text`, i, 'blockText', b.text)
    b.priceGroups.forEach((g) => {
      add(`${k}.g.${g.id}.title`, i, 'groupTitle', g.title)
      g.columns.forEach((c) => add(`${k}.g.${g.id}.col.${c.id}`, i, 'column', c.name))
      g.options.forEach((o) => add(`${k}.g.${g.id}.opt.${o.id}`, i, 'option', o.name))
    })
    b.choiceColumns.forEach((c) => add(`${k}.ccol.${c.id}`, i, 'column', c.name))
    b.choices.forEach((ch) => {
      add(`${k}.ch.${ch.id}`, i, 'choice', ch.name)
      Object.entries(ch.values).forEach(([colId, v]) => add(`${k}.ch.${ch.id}.v.${colId}`, i, 'choiceValue', v))
    })
  })
  return out
}

/** 원문 언어를 뺀 번역 대상 언어. 원문 언어를 모르면 전부 */
export function targetLocales(sourceLocale: string | null): Locale[] {
  return routing.locales.filter((l) => l !== sourceLocale)
}

/** 원문 키 → 글 */
export function sourceMap(p: Translatable): Record<string, string> {
  return Object.fromEntries(productTexts(p).map((e) => [e.key, e.source]))
}

/** 번역이 없거나(missing) 번역할 때의 원문이 지금과 다른(stale) 키 */
export function outdatedKeys(current: Record<string, string>, translatedFrom: Record<string, string>, texts: Record<string, string>) {
  const missing: string[] = []
  const stale: string[] = []
  for (const [key, source] of Object.entries(current)) {
    if (!texts[key]?.trim()) missing.push(key)
    else if (translatedFrom[key] !== source) stale.push(key)
  }
  return { missing, stale }
}

/** 상품에 번역문을 끼워 넣은 사본. 번역이 없는 칸은 원문 그대로 — TP에 언어별 상품 정보를 줄 때 쓴다 */
export function localizeProduct<T extends Translatable>(p: T, texts: Record<string, string>): T {
  const tr = (key: string, source: string) => texts[key]?.trim() || source
  const pt: PriceTable = {
    ...p.priceTable,
    title: tr('pt.title', p.priceTable.title),
    priceText: tr('pt.text', p.priceTable.priceText),
    categories: p.priceTable.categories.map((c) => ({ ...c, name: tr(`pt.cat.${c.id}`, c.name) })),
    plans: p.priceTable.plans.map((pl) => ({ ...pl, name: tr(`pt.plan.${pl.id}`, pl.name) })),
    roomTypes: p.priceTable.roomTypes.map((r) => ({ ...r, name: tr(`pt.room.${r.id}`, r.name) })),
  }
  const blocks: Block[] = p.blocks.map((b) => {
    const k = `b.${b.id}`
    return {
      ...b,
      title: tr(`${k}.title`, b.title),
      text: tr(`${k}.text`, b.text),
      priceGroups: b.priceGroups.map((g) => ({
        ...g,
        title: tr(`${k}.g.${g.id}.title`, g.title),
        columns: g.columns.map((c) => ({ ...c, name: tr(`${k}.g.${g.id}.col.${c.id}`, c.name) })),
        options: g.options.map((o) => ({ ...o, name: tr(`${k}.g.${g.id}.opt.${o.id}`, o.name) })),
      })),
      choiceColumns: b.choiceColumns.map((c) => ({ ...c, name: tr(`${k}.ccol.${c.id}`, c.name) })),
      choices: b.choices.map((ch) => ({
        ...ch,
        name: tr(`${k}.ch.${ch.id}`, ch.name),
        values: Object.fromEntries(Object.entries(ch.values).map(([colId, v]) => [colId, tr(`${k}.ch.${ch.id}.v.${colId}`, v)])),
      })),
    }
  })
  return { ...p, name: tr('name', p.name), description: tr('description', p.description), priceTable: pt, blocks }
}

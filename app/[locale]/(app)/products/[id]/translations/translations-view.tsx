'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { LOCALE_LABELS, routing, type Locale } from '@/i18n/routing'
import type { ErrorKey } from '@/lib/errors'
import { displayTitle } from '@/lib/products/default-titles'
import type { TextEntry } from '@/lib/products/translation'
import type { LocaleTranslation, ProductTranslations } from '@/lib/server/products/translations'
import { retranslateProduct, saveProductTranslation, setProductSourceLocale } from '../../actions'

const STATE_CLASS: Record<LocaleTranslation['state'], string> = { none: 'status-hidden', auto: 'status-review', reviewed: 'status-live' }

const localeLabel = (code: string) => LOCALE_LABELS[code as Locale] ?? code

export function TranslationsView({ data, readOnly }: { data: ProductTranslations; readOnly: boolean }) {
  const t = useTranslations()
  const tt = useTranslations('productTranslation')
  const uiLocale = useLocale()
  const [active, setActive] = useState<Locale>(data.locales[0]?.locale ?? routing.locales[0])
  // 언어별로 고친 칸 (키 → 글). 저장하면 그 언어 것만 비운다
  const [edits, setEdits] = useState<Partial<Record<Locale, Record<string, string>>>>({})
  const [error, setError] = useState<ErrorKey | null>(null)
  // "다시 번역" 확인 팝업
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 번역 중인 언어 — 그동안 화면을 어둡게 덮고 가운데 로딩을 띄운다
  const [translating, setTranslating] = useState<Locale | null>(null)
  const [pending, startTransition] = useTransition()

  const current = data.locales.find((l) => l.locale === active) ?? data.locales[0]
  const myEdits = (current && edits[current.locale]) ?? {}
  const stale = new Set(current?.stale ?? [])
  const missing = new Set(current?.missing ?? [])
  const outdatedCount = stale.size + missing.size

  function run(action: () => Promise<{ error?: ErrorKey }>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setError(result.error)
      else after?.()
    })
  }

  const clearEdits = (locale: Locale) => setEdits((prev) => ({ ...prev, [locale]: {} }))

  function translate(locale: Locale) {
    setError(null)
    setTranslating(locale)
    startTransition(async () => {
      const result = await retranslateProduct(data.id, locale)
      if (result.error) setError(result.error)
      else clearEdits(locale)
      setTranslating(null)
    })
  }

  // 기본 정보 · 요금표 · 섹션(블록)별로 묶는다
  const groups: { title: string; entries: TextEntry[] }[] = []
  for (const e of data.entries) {
    const title =
      e.section === 'basic'
        ? tt('section.basic')
        : e.section === 'price'
          ? tt('section.price')
          : displayTitle(data.blockTitles[e.section], uiLocale) || tt('section.block', { n: e.section + 1 })
    const last = groups[groups.length - 1]
    if (last?.title === title) last.entries.push(e)
    else groups.push({ title, entries: [e] })
  }

  return (
    <div>
      <section className="page-heading">
        <div>
          <p className="eyebrow">TRANSLATION</p>
          <h1>{tt('title')}</h1>
          <p className="heading-sub">{data.name}</p>
        </div>
        {/* 상품 목록의 번역 칸에서 들어온다 */}
        <Link href="/products" className="outline-button">
          {t('products.backToList')}
        </Link>
      </section>

      <div className="card products-card">
        <div className="tr-toolbar">
          <label className="tr-source">
            <span>{tt('sourceLocale')}</span>
            <select
              value={data.sourceLocale ?? ''}
              disabled={readOnly || pending}
              onChange={(e) => run(() => setProductSourceLocale(data.id, e.target.value))}
            >
              {!data.sourceLocale && <option value="">{tt('sourceUnknown')}</option>}
              {routing.locales.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>

          <div className="filter-chips" role="tablist" aria-label={tt('targetLocales')}>
            {data.locales.map((l) => {
              const n = l.stale.length + l.missing.length
              return (
                <button
                  key={l.locale}
                  type="button"
                  role="tab"
                  aria-selected={l.locale === active}
                  className={`filter-chip${l.locale === active ? ' is-active' : ''}`}
                  onClick={() => setActive(l.locale)}
                >
                  {localeLabel(l.locale)}
                  <span className={`status ${STATE_CLASS[l.state]} tr-chip-state`}>
                    <i />
                    {tt(`state.${l.state}`)}
                  </span>
                  {l.state !== 'none' && n > 0 && <span className="tr-chip-warn">{tt('outdatedCount', { count: n })}</span>}
                </button>
              )
            })}
          </div>

          {!readOnly && current && data.entries.length > 0 && (
            <button
              type="button"
              className="outline-button tr-retranslate"
              disabled={pending}
              onClick={() => (current.state === 'none' ? translate(current.locale) : setConfirmOpen(true))}
            >
              {current.state === 'none' ? tt('translateNow') : tt('retranslate')}
            </button>
          )}
        </div>

        {translating && (
          <div className="tr-loading" role="status" aria-live="polite">
            <span className="tr-spinner" />
            <p>{tt('translating', { language: tt(`localeName.${translating}`) })}</p>
          </div>
        )}

        {confirmOpen && current && (
          <div className="modal-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
            <div className="modal-card tr-confirm" role="dialog" aria-modal="true" aria-labelledby="tr-confirm-title" onClick={(e) => e.stopPropagation()}>
              <h2 id="tr-confirm-title">{tt('retranslateTitle')}</h2>
              <p className="tr-confirm-locale">
                <span>{tt('retranslateLanguage')}</span>
                <strong>
                  {tt(`localeName.${current.locale}`)}
                  {tt(`localeName.${current.locale}`) !== localeLabel(current.locale) && <em>{localeLabel(current.locale)}</em>}
                </strong>
              </p>
              <p className="tr-confirm-text">{tt('retranslateConfirm', { language: tt(`localeName.${current.locale}`) })}</p>
              <p className="tr-confirm-note">{tt('retranslateNote')}</p>
              <div className="modal-actions">
                <button type="button" className="outline-button" onClick={() => setConfirmOpen(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmOpen(false)
                    translate(current.locale)
                  }}
                >
                  {tt('retranslate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {current && (
          <>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="tr-table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>{tt('column.field')}</th>
                    <th>{tt('column.source', { locale: data.sourceLocale ? localeLabel(data.sourceLocale) : tt('sourceUnknown') })}</th>
                    <th>{tt('column.translation', { locale: localeLabel(current.locale) })}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <TranslationGroup
                      key={g.title + g.entries[0].key}
                      title={g.title}
                      entries={g.entries}
                      texts={current.texts}
                      previousSources={current.previousSources}
                      edits={myEdits}
                      stale={stale}
                      missing={missing}
                      readOnly={readOnly}
                      onEdit={(key, value) => setEdits((prev) => ({ ...prev, [current.locale]: { ...prev[current.locale], [key]: value } }))}
                    />
                  ))}
                  {data.entries.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                        {tt('empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {error && <p className="tr-error">{t(`errors.${error}`)}</p>}

            {!readOnly && data.entries.length > 0 && (
              <div className="tr-actions">
                <span className="tr-actions-gap" />
                <button
                  type="button"
                  className="outline-button"
                  disabled={pending || Object.keys(myEdits).length === 0}
                  onClick={() => run(() => saveProductTranslation(data.id, current.locale, myEdits, false), () => clearEdits(current.locale))}
                >
                  {tt('save')}
                </button>
                {current.state !== 'reviewed' || outdatedCount > 0 ? (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={pending || current.state === 'none'}
                    onClick={() => run(() => saveProductTranslation(data.id, current.locale, myEdits, true), () => clearEdits(current.locale))}
                  >
                    {tt('markReviewed')}
                  </button>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TranslationGroup({
  title,
  entries,
  texts,
  previousSources,
  edits,
  stale,
  missing,
  readOnly,
  onEdit,
}: {
  title: string
  entries: TextEntry[]
  texts: Record<string, string>
  previousSources: Record<string, string>
  edits: Record<string, string>
  stale: Set<string>
  missing: Set<string>
  readOnly: boolean
  onEdit: (key: string, value: string) => void
}) {
  const tt = useTranslations('productTranslation')
  return (
    <>
      <tr className="tr-group">
        <td colSpan={3}>{title}</td>
      </tr>
      {entries.map((e) => {
        const value = edits[e.key] ?? texts[e.key] ?? ''
        const long = e.field === 'description' || e.field === 'blockText' || e.field === 'priceText'
        return (
          <tr key={e.key} className={stale.has(e.key) || (missing.has(e.key) && Object.keys(texts).length > 0) ? 'tr-outdated' : undefined}>
            <td className="muted">
              {tt(`field.${e.field}`)}
              {stale.has(e.key) && (
                <span className="tr-tag" title={tt('previousSource', { text: previousSources[e.key] ?? '' })}>
                  {tt('sourceChanged')}
                </span>
              )}
              {missing.has(e.key) && Object.keys(texts).length > 0 && <span className="tr-tag">{tt('notTranslated')}</span>}
            </td>
            <td className="tr-source-text">{e.source}</td>
            <td>
              {readOnly ? (
                <span className="tr-source-text">{value}</span>
              ) : (
                <textarea
                  className="tr-input"
                  rows={long ? Math.min(10, Math.max(3, value.split('\n').length + 1)) : 1}
                  value={value}
                  onChange={(ev) => onEdit(e.key, ev.target.value)}
                  aria-label={tt(`field.${e.field}`)}
                />
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Languages, Search, Sparkles, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { AiText } from '@/components/ai-tag'
import { INQUIRY_LANGUAGE_LABEL, type InquiryLanguageCode } from '@/lib/inquiry-language'
import { LOCALE_LABELS, type Locale } from '@/i18n/routing'
import { usePathname, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { PAGE_SIZE } from '@/lib/pagination'
import { answerInquiry, saveTranslation } from './actions'
import type { InquiryRow } from '@/lib/server/inquiries/service'
import { formatJstDateTime } from '@/lib/datetime'

type StatusCode = 'pending' | 'answered'

// 새 문의를 이 주기로 다시 물어본다(router.refresh()로 서버 목록 재조회). SSE 대신 폴링 — 서버리스
// 환경에서 커넥션을 오래 들고 있지 않으려는 선택이라 "즉시"는 아니고 "몇 초 지연"이다.
const INQUIRY_POLL_MS = 10_000

// 고객 문의 원문을 관리자가 읽을 수 있게 번역할 때의 목표 언어 — 관리자 화면 언어(UI locale) 기준.
// BE inquiry/InquiryTranslateController 의 LABEL_TO_CODE 키와 맞춰야 한다. 화면 문구가 아니라 번역 API 호출용
// 내부 키라서 next-intl로 안 옮긴다(옮기면 언어별로 값이 달라져서 API 매핑이 깨진다).
const LOCALE_TO_TRANSLATE_LABEL: Record<Locale, string> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  vi: '베트남어',
  'zh-CN': '중국어',
  'zh-TW': '중국어(번체)',
}

async function callTranslate(text: string, targetLang: string, sourceLang: string | undefined, failMessage: string): Promise<string> {
  if (!text.trim()) return ''
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang, sourceLang }),
  })
  const body = await res.json().catch(() => null)
  // 서버 에러 문구는 한국어 고정이라 화면엔 화면 언어 실패 문구만 보여주고, 원인은 콘솔에 남긴다
  if (!res.ok || !body) {
    console.error('[translate]', body?.error ?? res.status)
    throw new Error(failMessage)
  }
  return body.translatedText as string
}

export function InquiriesView({
  inquiries: initialInquiries,
  initialSelectedId = null,
  total,
  page,
  keyword: initialKeyword,
  status: initialStatus,
  partners,
  partnerId: initialPartnerId,
  products,
  productId: initialProductId,
}: {
  inquiries: InquiryRow[]
  initialSelectedId?: string | null
  total: number
  page: number
  keyword: string
  status: string
  partners: { id: string; name: string }[]
  partnerId: string
  products: { id: string; name: string; partnerId: string }[]
  productId: string
}) {
  const t = useTranslations()
  const tq = useTranslations('inquiries')
  const locale = useLocale() as Locale
  // 화면에 보여줄 언어 이름(번역됨). INQUIRY_LANGUAGE_LABEL(한글 고정값)은 번역 API 호출에만 쓴다 — 혼동 금지
  const languageDisplay = (code: InquiryLanguageCode) => tq(`language.${code}`)
  const formatDateTime = (iso: string) =>
    formatJstDateTime(iso, locale)
  const STATUS_LABEL: Record<StatusCode, string> = { pending: tq('status.pending'), answered: tq('status.answered') }
  const router = useRouter()
  const pathname = usePathname()
  const [inquiries, setInquiries] = useState(initialInquiries)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [partnerFilter, setPartnerFilter] = useState(initialPartnerId)
  const [productFilter, setProductFilter] = useState(initialProductId)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [draftAnswer, setDraftAnswer] = useState('')
  const [draftTranslated, setDraftTranslated] = useState('')
  const [translatingMessageIds, setTranslatingMessageIds] = useState<Set<string>>(new Set())
  const [translatingAnswer, setTranslatingAnswer] = useState(false)
  // 다른 언어 관리자가 쓴 답변을 내 화면 언어로 번역한 결과 (messageId → 번역문). 보기용이라 저장하지 않는다
  const [adminMessageTranslations, setAdminMessageTranslations] = useState<Record<string, string>>({})
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const keywordDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 답변 등록·번역 저장 뒤 refresh()로 서버 목록이 다시 내려오면(= initialInquiries가 새 배열로 바뀌면) 맞춰준다.
  useEffect(() => {
    setInquiries(initialInquiries)
  }, [initialInquiries])

  // 새 문의 폴링 — 탭이 백그라운드면 쉬고, 다시 보일 때 바로 한 번 맞춘다. 지금 페이지·검색·필터 그대로 다시 조회.
  useEffect(() => {
    function poll() {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const id = setInterval(poll, INQUIRY_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [router])

  useEffect(() => () => {
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
  }, [])

  // keyword·status·partnerId·productId·page는 URL 쿼리로 들고 있다 — 검색·필터·페이지 이동마다 서버에서 다시 조회한다.
  function pushQuery(next: { keyword?: string; status?: string; partnerId?: string; productId?: string; page?: number }) {
    const merged = { keyword, status: statusFilter, partnerId: partnerFilter, productId: productFilter, page, ...next }
    const query: Record<string, string> = {}
    if (merged.keyword) query.keyword = merged.keyword
    if (merged.status && merged.status !== 'all') query.status = merged.status
    if (merged.partnerId && merged.partnerId !== 'all') query.partnerId = merged.partnerId
    if (merged.productId && merged.productId !== 'all') query.productId = merged.productId
    if (merged.page && merged.page > 1) query.page = String(merged.page)
    router.replace({ pathname, query })
  }

  function handleKeywordChange(value: string) {
    setKeyword(value)
    if (keywordDebounce.current) clearTimeout(keywordDebounce.current)
    keywordDebounce.current = setTimeout(() => pushQuery({ keyword: value, page: 1 }), 400)
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value)
    pushQuery({ status: value, page: 1 })
  }

  // 업체를 바꾸면 그 업체 소속이 아닌 상품 선택은 의미가 없어지니 같이 초기화
  function handlePartnerChange(value: string) {
    setPartnerFilter(value)
    setProductFilter('all')
    pushQuery({ partnerId: value, productId: 'all', page: 1 })
  }

  function handleProductChange(value: string) {
    setProductFilter(value)
    pushQuery({ productId: value, page: 1 })
  }

  const productOptions = partnerFilter === 'all' ? products : products.filter((p) => p.partnerId === partnerFilter)

  const selected = inquiries.find((q) => q.id === selectedId) ?? null

  function openDetail(q: InquiryRow) {
    setSelectedId(q.id)
    setDraftAnswer('')
    setDraftTranslated('')
    setTranslateError(null)
  }

  async function translateCustomerMessage(messageId: string, originalText: string, customerLanguage: InquiryLanguageCode) {
    if (translatingMessageIds.has(messageId)) return // 더블클릭·레이스로 같은 메시지를 두 번 번역하지 않도록
    setTranslatingMessageIds((prev) => new Set(prev).add(messageId))
    setTranslateError(null)
    try {
      const translated = await callTranslate(originalText, LOCALE_TO_TRANSLATE_LABEL[locale], INQUIRY_LANGUAGE_LABEL[customerLanguage], tq('translateFailed'))
      const result = await saveTranslation(messageId, translated, locale)
      if (result.error) throw new Error(t(`errors.${result.error}`))
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : tq('translateFailed'))
    } finally {
      setTranslatingMessageIds((prev) => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
  }

  async function translateAdminMessage(messageId: string, text: string, textLocale: Locale) {
    if (translatingMessageIds.has(messageId)) return
    setTranslatingMessageIds((prev) => new Set(prev).add(messageId))
    setTranslateError(null)
    try {
      const translated = await callTranslate(text, LOCALE_TO_TRANSLATE_LABEL[locale], LOCALE_TO_TRANSLATE_LABEL[textLocale], tq('translateFailed'))
      setAdminMessageTranslations((prev) => ({ ...prev, [messageId]: translated }))
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : tq('translateFailed'))
    } finally {
      setTranslatingMessageIds((prev) => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
    }
  }

  // 제출 전 검수용 — saveTranslation과 달리 여기서는 바로 저장하지 않는다
  async function translateDraftAnswer(customerLanguage: InquiryLanguageCode) {
    setTranslatingAnswer(true)
    setTranslateError(null)
    try {
      const translated = await callTranslate(draftAnswer, INQUIRY_LANGUAGE_LABEL[customerLanguage], LOCALE_TO_TRANSLATE_LABEL[locale], tq('translateFailed'))
      setDraftTranslated(translated)
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : tq('translateFailed'))
    } finally {
      setTranslatingAnswer(false)
    }
  }

  function submitAnswer() {
    if (!selected || !draftAnswer.trim() || !draftTranslated.trim()) return
    startTransition(async () => {
      const result = await answerInquiry(selected.id, draftAnswer, draftTranslated, locale)
      if (result.error) {
        setTranslateError(t(`errors.${result.error}`))
        return
      }
      setDraftAnswer('')
      setDraftTranslated('')
    })
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">INQUIRIES</p>
          <h1>{t('page.inquiries.title')}</h1>
        </div>
      </section>

      <div className="card products-card">
        {/* 필터는 접어두지 않는다: 위 줄은 검색·업체·상품, 아래 줄은 답변 상태 칩 (예약 화면과 같은 배치) */}
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div className="search-box">
            <Search size={17} />
            <input placeholder={tq('searchPlaceholder')} value={keyword} onChange={(e) => handleKeywordChange(e.target.value)} />
          </div>
          {partners.length > 1 && (
            <select className="toolbar-select" value={partnerFilter} onChange={(e) => handlePartnerChange(e.target.value)} aria-label={tq('colPartner')}>
              <option value="all">
                {tq('colPartner')}: {tq('statusAll')}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select className="toolbar-select" value={productFilter} onChange={(e) => handleProductChange(e.target.value)} aria-label={tq('colProduct')}>
            <option value="all">
              {tq('colProduct')}: {tq('statusAll')}
            </option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-chips" role="group" aria-label={tq('statusFilterLabel')}>
          {(['all', 'pending', 'answered'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`filter-chip${statusFilter === value ? ' is-active' : ''}`}
              aria-pressed={statusFilter === value}
              onClick={() => handleStatusChange(value)}
            >
              {value === 'all' ? tq('statusAll') : STATUS_LABEL[value]}
            </button>
          ))}
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{tq('colPartner')}</th>
                <th>{tq('colProduct')}</th>
                <th>{tq('colCustomer')}</th>
                <th>{tq('colLanguage')}</th>
                <th>{tq('colQuestion')}</th>
                <th>{tq('colCreatedAt')}</th>
                <th>{tq('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((q) => (
                <tr key={q.id}>
                  <td>
                    <button className="table-link" onClick={() => openDetail(q)}>
                      <strong>{q.partnerName}</strong>
                    </button>
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    <AiText ai={q.productNameAi}>{q.productName}</AiText>
                  </td>
                  <td>{q.customerName}</td>
                  <td>
                    <span className="status status-hidden">
                      <Languages size={10} />
                      {languageDisplay(q.language as InquiryLanguageCode)}
                    </span>
                  </td>
                  <td className="muted" style={{ maxWidth: 260 }}>
                    {/* 내 화면 언어 번역이 있으면 번역문(✨ 표시), 없으면 원문 */}
                    {q.questionTranslatedLocale === locale && q.questionTranslated ? (
                      <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 4 }}>
                        <Sparkles size={12} style={{ marginTop: 2, flexShrink: 0, color: '#e4713e' }} />
                        {q.questionTranslated}
                      </span>
                    ) : (
                      q.question
                    )}
                  </td>
                  <td className="muted">{formatDateTime(q.createdAt)}</td>
                  <td>
                    <span className={`status ${q.status === 'answered' ? 'status-live' : 'status-review'}`}>
                      <i />
                      {STATUS_LABEL[q.status as StatusCode]}
                    </span>
                  </td>
                </tr>
              ))}
              {inquiries.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                    {tq('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(next) => pushQuery({ page: next })} />
      </div>

      {selected && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedId(null)}>
          <div className="modal-card" style={{ width: 'min(620px,100%)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <p className="eyebrow">
                  {selected.partnerName} · <AiText ai={selected.productNameAi}>{selected.productName}</AiText>
                </p>
                <h2>{tq('detailTitle', { name: selected.customerName })}</h2>
              </div>
              <button className="close-button" onClick={() => setSelectedId(null)} aria-label={t('common.close')}>
                <X size={19} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '18px 0', maxHeight: 280, overflowY: 'auto' }}>
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === 'customer' ? 'flex-start' : 'flex-end',
                    maxWidth: '85%',
                    background: m.sender === 'customer' ? '#fafaf8' : '#fff4ef',
                    border: `1px solid ${m.sender === 'customer' ? 'var(--border)' : '#f1c3a8'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 10, fontWeight: 700 }}>
                      {m.sender === 'customer'
                        ? `${selected.customerName} (${languageDisplay(selected.language as InquiryLanguageCode)})`
                        : tq('senderAdmin')}
                    </span>
                    <span className="muted" style={{ fontSize: 9 }}>
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12 }}>{m.text}</p>
                  {m.sender === 'customer' && (
                    <>
                      {/* 번역은 번역한 관리자의 화면 언어로 저장된다 — 지금 화면 언어와 같을 때만 보여주고,
                          다르면 원문만 두고 버튼으로 내 언어로 다시 번역(덮어쓰기)하게 한다. */}
                      {m.textTranslated && m.translatedLocale === locale && (
                        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#e4713e', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                          <Sparkles size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                          {m.textTranslated}
                        </p>
                      )}
                      <button
                        type="button"
                        className="outline-button"
                        style={{ marginTop: 6 }}
                        disabled={translatingMessageIds.has(m.id)}
                        onClick={() => translateCustomerMessage(m.id, m.text, selected.language as InquiryLanguageCode)}
                      >
                        <Sparkles size={13} />{' '}
                        {translatingMessageIds.has(m.id)
                          ? tq('translating')
                          : m.textTranslated && m.translatedLocale === locale
                            ? tq('retranslate')
                            : tq('translateOriginal')}
                      </button>
                    </>
                  )}
                  {m.sender === 'admin' && m.textLocale && m.textLocale !== locale && (
                    <>
                      {adminMessageTranslations[m.id] && (
                        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#e4713e', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                          <Sparkles size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                          {adminMessageTranslations[m.id]}
                        </p>
                      )}
                      {!adminMessageTranslations[m.id] && (
                        <button
                          type="button"
                          className="outline-button"
                          style={{ marginTop: 6 }}
                          disabled={translatingMessageIds.has(m.id)}
                          onClick={() => translateAdminMessage(m.id, m.text, m.textLocale as Locale)}
                        >
                          <Sparkles size={13} /> {translatingMessageIds.has(m.id) ? tq('translating') : tq('translateOriginal')}
                        </button>
                      )}
                    </>
                  )}
                  {m.sender === 'admin' && m.textTranslated && (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9a7257', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                      <Languages size={12} style={{ marginTop: 1, flexShrink: 0 }} />
                      {tq('translatedPrefix', { lang: languageDisplay(selected.language as InquiryLanguageCode), text: m.textTranslated })}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <label className="modal-label">
              {tq('answerLabel', { lang: LOCALE_LABELS[locale] })}
              <textarea
                value={draftAnswer}
                onChange={(e) => setDraftAnswer(e.target.value)}
                placeholder={tq('answerPlaceholder')}
                style={{ minHeight: 70, border: '1px solid var(--border)', borderRadius: 7, padding: 10, font: 'inherit' }}
              />
            </label>

            <button
              type="button"
              className="outline-button"
              disabled={!draftAnswer.trim() || translatingAnswer}
              onClick={() => translateDraftAnswer(selected.language as InquiryLanguageCode)}
            >
              <Sparkles size={14} /> {translatingAnswer ? tq('translating') : tq('translateAnswerButton')}
            </button>

            {translateError && <p style={{ color: '#c45b4d', fontSize: 11, margin: 0 }}>{translateError}</p>}

            <label className="modal-label">
              {tq('translatedResultLabel', { lang: languageDisplay(selected.language as InquiryLanguageCode) })}
              <textarea
                value={draftTranslated}
                onChange={(e) => setDraftTranslated(e.target.value)}
                placeholder={tq('translatedResultPlaceholder')}
                style={{ minHeight: 60, border: '1px solid var(--border)', borderRadius: 7, padding: 10, font: 'inherit' }}
              />
            </label>

            <div className="modal-actions">
              <button className="outline-button" onClick={() => setSelectedId(null)}>
                {t('common.close')}
              </button>
              <button
                className="primary-button"
                onClick={submitAnswer}
                disabled={!draftAnswer.trim() || !draftTranslated.trim() || pending}
                title={!draftTranslated.trim() ? tq('translateFirst') : undefined}
              >
                {pending ? tq('submitting') : tq('submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

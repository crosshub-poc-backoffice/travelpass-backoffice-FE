import 'server-only'
import { backend, BackendError, qs, seg } from '@/lib/api/backend'
import type { InquiryStatus as DbInquiryStatus } from '@/lib/generated/prisma/client'
import { productIdsMatching } from '@/lib/server/products/service'
import { PAGE_SIZE } from '@/lib/pagination'
import type { SessionUser } from '@/lib/server/auth/session'
import { visiblePartnerIds } from '@/lib/server/auth/session'

const INQUIRY_STATUSES: DbInquiryStatus[] = ['pending', 'answered']

/** searchParams로 들어온 status 문자열이 실제 문의 상태 enum인지 확인 (url 조작 방어) */
export function isInquiryStatus(value: string | undefined): value is DbInquiryStatus {
  return !!value && INQUIRY_STATUSES.includes(value as DbInquiryStatus)
}

/** BE(/api/v1/inquiries) 요약 응답 모양. partnerName·messages까지 포함(InquiryDetailResponse와 거의 같음). */
type BeInquirySummary = {
  id: string
  productId: string
  productName: string | null
  partnerId: string | null
  partnerName: string | null
  customerName: string
  language: string
  question: string
  questionTranslated: string | null
  questionTranslatedLocale: string | null
  status: DbInquiryStatus
  createdAt: string
  messages: {
    id: string
    sender: string
    text: string
    textTranslated: string | null
    translatedLocale: string | null
    textLocale: string | null
    createdAt: string
  }[]
}

/**
 * BE도 bookings처럼 고정 페이지네이션(20개)이고 dev 모드엔 업체범위를 못 걸러서, 페이지네이션은 안 쓰고
 * 전체를 모아 FE가 범위·필터·정렬·페이지네이션을 직접 한다 (products/bookings와 동일한 이유).
 */
async function fetchAllInquiriesFromBe(): Promise<BeInquirySummary[]> {
  const first = await backend.get<{ rows: BeInquirySummary[]; total: number; page: number; size: number }>('/api/v1/inquiries?page=1')
  const rows = [...first.rows]
  const totalPages = first.size > 0 ? Math.ceil(first.total / first.size) : 1
  for (let page = 2; page <= totalPages; page++) {
    const next = await backend.get<{ rows: BeInquirySummary[]; total: number; page: number; size: number }>(`/api/v1/inquiries${qs({ page })}`)
    rows.push(...next.rows)
  }
  return rows
}

function toInquiryRow(r: BeInquirySummary) {
  return {
    id: r.id,
    partnerName: r.partnerName ?? '',
    productId: r.productId,
    productName: r.productName ?? '',
    /** productName이 보는 사람 언어의 AI 번역이면 true (페이지에서 채운다) */
    productNameAi: false,
    customerName: r.customerName,
    language: r.language,
    question: r.question,
    questionTranslated: r.questionTranslated,
    questionTranslatedLocale: r.questionTranslatedLocale,
    status: r.status,
    createdAt: r.createdAt,
    messages: r.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      textTranslated: m.textTranslated,
      translatedLocale: m.translatedLocale,
      textLocale: m.textLocale,
      createdAt: m.createdAt,
    })),
  }
}

export type InquiryRow = ReturnType<typeof toInquiryRow>

/** 대시보드용: 답변대기 문의 오래 기다린 순 상위 N건(목록 칸만, 대화 스레드 없이) + 전체 건수. 업체 전환으로 고른 업체가 있으면 그 업체만 */
export async function listPendingInquiries(user: SessionUser, limit = 5) {
  const res = await backend.get<{ rows: { id: string; partnerName: string | null; customerName: string; language: string; createdAt: string }[]; total: number }>(
    `/api/v1/inquiries/pending${qs({ limit, partnerId: user.activePartnerId ?? undefined })}`,
  )
  return { rows: res.rows.map((r) => ({ ...r, partnerName: r.partnerName ?? '' })), total: res.total }
}

export type PendingInquiryRow = Awaited<ReturnType<typeof listPendingInquiries>>['rows'][number]

// partnerId·productId는 로그인 범위(scopeWhere) 안에서 한 번 더 좁히는 화면 필터 — 범위 밖 값이면 결과가 비게 된다
export type InquiryListParams = { page: number; keyword?: string; status?: DbInquiryStatus; partnerId?: string; productId?: string }

// 화면이 목록·상세를 한 화면(모달)에서 같이 쓰고 데이터양도 적어서, 목록 조회에 메시지 스레드까지 같이 담아 돌려준다.
export async function listInquiries(user: SessionUser, params: InquiryListParams): Promise<{ rows: InquiryRow[]; total: number }> {
  const keyword = params.keyword?.trim()
  const partnerIds = visiblePartnerIds(user)

  const beRows = await fetchAllInquiriesFromBe()
  // 업체범위는 BE가 dev 모드에서 못 걸러서 FE가 직접 (products/bookings와 동일한 이유)
  let scoped = beRows.filter((r) => r.partnerId != null && partnerIds.includes(r.partnerId))
  if (params.partnerId) scoped = scoped.filter((r) => r.partnerId === params.partnerId)
  if (params.productId) scoped = scoped.filter((r) => r.productId === params.productId)

  if (keyword) {
    const kw = keyword.toLowerCase()
    const directMatchIds = new Set(
      scoped
        .filter(
          (r) =>
            r.customerName.toLowerCase().includes(kw) ||
            (r.partnerName ?? '').toLowerCase().includes(kw) ||
            (r.productName ?? '').toLowerCase().includes(kw) ||
            r.question.toLowerCase().includes(kw) ||
            // 목록 화면엔 번역문(자동번역)이 보이므로, 관리자가 화면에서 본 그대로 검색해도 찾아지게 번역문도 같이 본다
            (r.questionTranslated ?? '').toLowerCase().includes(kw),
        )
        .map((r) => r.id),
    )
    // 상품명 검색은 번역된 이름도 매칭 (BE 상품 검색이 원문·번역 상품명을 같이 본다)
    const matchedProductIds = await productIdsMatching(keyword)
    scoped = scoped.filter((r) => directMatchIds.has(r.id) || matchedProductIds.has(r.productId))
  }

  // 처리 순서대로 보여준다: 답변대기는 오래 기다린 순(먼저 온 것부터), 답변완료는 그 아래 최신순.
  // 두 묶음의 정렬 방향이 달라 한 번에 못 하니, 답변대기 건수를 기준으로 페이지를 두 묶음에 나눠 담는다.
  const skip = (params.page - 1) * PAGE_SIZE

  if (params.status) {
    const filtered = scoped.filter((r) => r.status === params.status)
    const sorted = [...filtered].sort((a, b) =>
      params.status === 'pending' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    const total = sorted.length
    const rows = sorted.slice(skip, skip + PAGE_SIZE)
    return { rows: rows.map(toInquiryRow), total }
  }

  const total = scoped.length
  const pending = [...scoped.filter((r) => r.status === 'pending')].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const answered = [...scoped.filter((r) => r.status !== 'pending')].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const pendingTotal = pending.length
  const pendingTake = Math.max(0, Math.min(PAGE_SIZE, pendingTotal - skip))
  const pendingRows = pendingTake > 0 ? pending.slice(skip, skip + pendingTake) : []
  const answeredRows = pendingTake < PAGE_SIZE ? answered.slice(Math.max(0, skip - pendingTotal), Math.max(0, skip - pendingTotal) + (PAGE_SIZE - pendingTake)) : []
  return { rows: [...pendingRows, ...answeredRows].map(toInquiryRow), total }
}

export type MutationResult = { ok: true } | { ok: false; error: 'notFound' | 'required' | 'tooLong' }

// 고객·관리자 메시지 번역 결과 저장. 화면의 "원문 자동번역 생성" 버튼이 /api/translate로 받아온 결과를
// 영구 저장해서, 다시 조회해도 재번역하지 않게 한다. locale은 번역한 관리자의 화면 언어.
// 소유 업체 확인·메시지/문의 양쪽 갱신·작업 이력은 BE(POST .../messages/{id}/translation)가 한다.
export async function saveMessageTranslation(_user: SessionUser, messageId: string, textTranslated: string, locale: string): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/inquiries/messages/${seg(messageId)}/translation`, { textTranslated, locale })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'required' || e.code === 'tooLong') return { ok: false, error: e.code }
    }
    throw e
  }
}

// 관리자 답변 등록. text·textTranslated는 화면에서 번역 검수까지 끝낸 값을 그대로 받는다.
// locale은 답변을 쓴 관리자의 화면 언어(= text의 언어). 소유 업체 확인·중복 방지·저장·작업 이력은
// BE(POST .../answer)가 한다. user는 이제 안 쓰지만(BE가 토큰으로 직접 확인), actions.ts 호출부를
// 안 바꾸려고 시그니처는 그대로 둔다.
export async function postAnswer(
  _user: SessionUser,
  inquiryId: string,
  text: string,
  textTranslated: string,
  locale: string,
): Promise<MutationResult> {
  try {
    await backend.post(`/api/v1/inquiries/${seg(inquiryId)}/answer`, { text, textTranslated: textTranslated || null, locale })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.code === 'required' || e.code === 'tooLong') return { ok: false, error: e.code }
    }
    throw e
  }
}

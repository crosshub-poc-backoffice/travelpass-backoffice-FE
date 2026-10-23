import 'server-only'
import { backend, BackendError, qs } from '@/lib/api/backend'
import { prisma } from '@/lib/db'
import { Prisma, type InquiryStatus as DbInquiryStatus } from '@/lib/generated/prisma/client'
import type { InquiryLanguageCode } from '@/lib/inquiry-language'
import { PAGE_SIZE } from '@/lib/pagination'
import type { SessionUser } from '@/lib/server/auth/session'
import { visiblePartnerIds } from '@/lib/server/auth/session'
import { audit } from '@/lib/server/audit/service'

function scopeWhere(user: SessionUser) {
  return { product: { partnerId: { in: visiblePartnerIds(user) } } }
}

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

/** 대시보드용: 답변대기 문의 오래 기다린 순 상위 N건(목록 칸만, 대화 스레드 없이) + 전체 건수 */
export async function listPendingInquiries(user: SessionUser, limit = 5) {
  const where: Prisma.InquiryWhereInput = { ...scopeWhere(user), status: 'pending' }
  const [rows, total] = await Promise.all([
    prisma.inquiry.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: { id: true, customerName: true, language: true, createdAt: true, product: { select: { partner: { select: { name: true } } } } },
      take: limit,
    }),
    prisma.inquiry.count({ where }),
  ])
  return {
    rows: rows.map((r) => ({ id: r.id, partnerName: r.product.partner.name, customerName: r.customerName, language: r.language, createdAt: r.createdAt.toISOString() })),
    total,
  }
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
    // 상품명 검색은 번역된 이름도 매칭 (products/bookings의 하이브리드와 같은 패턴)
    const translatedMatches = await prisma.productTranslation.findMany({
      where: { productId: { in: [...new Set(scoped.map((r) => r.productId))] }, texts: { path: ['name'], string_contains: keyword } },
      select: { productId: true },
    })
    const matchedProductIds = new Set(translatedMatches.map((t) => t.productId))
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

export type MutationResult = { ok: true } | { ok: false; error: 'notFound' }

// 고객 메시지 번역 결과 저장. 화면의 "원문 자동번역 생성" 버튼이 /api/translate로 받아온 결과를
// 로컬 상태로만 들고 있던 걸 여기로 영구 저장해서, 다시 조회해도 재번역하지 않게 한다.
// locale은 번역한 관리자의 화면 언어 — 다른 언어 화면에선 이 번역문 대신 원문을 보여주고 다시 번역하게 한다.
// 고객 메시지는 Inquiry.questionTranslated로도 중복 저장돼 있어서(목록 화면이 그 값을 봄) 같이 갱신한다 —
// 안 그러면 모달엔 번역이 보여도 목록엔 계속 원문만 보이는 불일치가 생긴다.
export async function saveMessageTranslation(user: SessionUser, messageId: string, textTranslated: string, locale: string): Promise<MutationResult> {
  const message = await prisma.inquiryMessage.findFirst({
    where: { id: messageId, inquiry: scopeWhere(user) },
    select: { id: true, sender: true, inquiryId: true, inquiry: { select: { customerName: true, product: { select: { partnerId: true } } } } },
  })
  if (!message) return { ok: false, error: 'notFound' }

  const updates: Prisma.PrismaPromise<unknown>[] = [
    prisma.inquiryMessage.update({
      where: { id: messageId },
      data: { textTranslated, translatedLocale: message.sender === 'customer' ? locale : null },
    }),
    audit({
      userId: user.id,
      action: 'inquiry_translation',
      partnerId: message.inquiry.product.partnerId,
      targetId: message.inquiryId,
      targetName: message.inquiry.customerName,
    }),
  ]

  if (message.sender === 'customer') {
    // 문의당 고객 메시지는 항상 1건(최초 질문)이라 바로 Inquiry.questionTranslated에 반영해도 된다.
    updates.push(prisma.inquiry.update({ where: { id: message.inquiryId }, data: { questionTranslated: textTranslated, questionTranslatedLocale: locale } }))
  } else {
    // admin 메시지는 여러 건일 수 있어서, 목록 화면이 보는 Inquiry.answerTranslated는
    // 가장 최근 답변의 번역일 때만 같이 갱신한다 — 옛 답변 번역을 고치면 최신 답변 번역이 덮어써지면 안 된다.
    const latestAdminMessage = await prisma.inquiryMessage.findFirst({
      where: { inquiryId: message.inquiryId, sender: 'admin' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (latestAdminMessage?.id === message.id) {
      updates.push(prisma.inquiry.update({ where: { id: message.inquiryId }, data: { answerTranslated: textTranslated } }))
    }
  }

  await prisma.$transaction(updates)
  return { ok: true }
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
    await backend.post(`/api/v1/inquiries/${inquiryId}/answer`, { text, textTranslated: textTranslated || null, locale })
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return { ok: false, error: 'notFound' }
    throw e
  }
}

// TP 앱에서 문의 상태·답변을 조회할 때 (GET /api/v1/inquiries/[id]). 앱은 POST 응답으로 받은 id를 들고 있다가 그대로 조회한다
// — 고객 로그인 체계가 없어서 id 자체가 조회 권한이다 (cuid라 추측은 어렵지만 진짜 인증은 아님).
export async function getInquiryForApp(id: string) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!inquiry) return null

  return {
    id: inquiry.id,
    customerName: inquiry.customerName,
    language: inquiry.language,
    question: inquiry.question,
    questionTranslated: inquiry.questionTranslated,
    answer: inquiry.answer,
    answerTranslated: inquiry.answerTranslated,
    status: inquiry.status,
    createdAt: inquiry.createdAt.toISOString(),
    updatedAt: inquiry.updatedAt.toISOString(),
    messages: inquiry.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      textTranslated: m.textTranslated,
      createdAt: m.createdAt.toISOString(),
    })),
  }
}

// TP 앱에서 고객이 새 문의를 등록할 때 (POST /api/v1/inquiries). 원문만 저장하고 번역은 하지 않는다 —
// 번역 대상 언어가 "보는 관리자의 화면 언어"라서(중국 고객-미국 관리자처럼 한국어가 전혀 필요 없는 조합도 있다),
// 접수 시점엔 누가 볼지 모르니 미리 번역해두지 않고 관리자가 상세를 열 때 "원문 자동번역 생성"으로 그때 번역한다.
//
// idempotencyKey로 재시도·중복 제출을 막는다: 앱의 네트워크 재시도나 중복 탭으로 같은 요청이 두 번 오면
// 문의를 또 만들고 번역도 또 호출하는 대신, 처음 만들어진 문의를 그대로 돌려준다.
export async function createInquiryFromApp(input: {
  productId: string
  customerName: string
  language: InquiryLanguageCode
  question: string
  idempotencyKey: string
}) {
  const existing = await prisma.inquiry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, createdAt: true },
  })
  if (existing) return { ok: true as const, id: existing.id, createdAt: existing.createdAt.toISOString() }

  // TP 앱은 노출중(live) 상품만 보여주니, 문의 시점에 숨겨졌거나 아직 심사중이면 상품을 못 찾은 것과 동일하게 막는다.
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, status: true } })
  if (!product || product.status !== 'live') return { ok: false as const, error: 'productNotFound' as const }

  try {
    const inquiry = await prisma.inquiry.create({
      data: {
        productId: input.productId,
        customerName: input.customerName,
        language: input.language,
        question: input.question,
        questionTranslated: '',
        idempotencyKey: input.idempotencyKey,
        messages: {
          create: { sender: 'customer', text: input.question, textTranslated: null },
        },
      },
      select: { id: true, createdAt: true },
    })

    return { ok: true as const, id: inquiry.id, createdAt: inquiry.createdAt.toISOString() }
  } catch (e) {
    // 위 조회 이후 거의 동시에 같은 키로 들어온 다른 요청이 먼저 만들었으면 유니크 제약이 막아준다 —
    // 그 경우 에러로 보지 않고 먼저 만들어진 문의를 그대로 돌려준다.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await prisma.inquiry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, createdAt: true },
      })
      if (winner) return { ok: true as const, id: winner.id, createdAt: winner.createdAt.toISOString() }
    }
    throw e
  }
}

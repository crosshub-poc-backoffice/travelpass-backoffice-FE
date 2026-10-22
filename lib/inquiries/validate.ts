// 화면(또는 TP 앱)에서 받은 문의 관련 입력값을 검사하고 정리한다. 모르는 필드는 버리고 길이를 제한한다.
// Route Handler·Server Action이 서비스에 넘기기 전에 꼭 거친다. (lib/products/validate.ts와 같은 역할)
import { INQUIRY_LANGUAGES, type InquiryLanguageCode } from '@/lib/inquiry-language'

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null)

export type CreateInquiryInput = {
  productId: string
  customerName: string
  language: InquiryLanguageCode
  question: string
  idempotencyKey: string
}

export type ParseResult = { ok: true; value: CreateInquiryInput } | { ok: false; error: 'required' | 'invalidLanguage' }

/** TP 앱이 보낸 문의 등록 요청을 검사한다. productId가 실제 존재하는지는 서비스(DB)에서 따로 확인한다.
 *  idempotencyKey는 앱이 요청 하나당 한 번만 만들어서 재시도에도 그대로 다시 보내는 값 — 같은 요청이
 *  두 번 들어와도 문의가 중복 생성되거나 번역 API가 중복 호출되지 않게 막는 데 쓴다. */
export function parseCreateInquiryInput(raw: unknown): ParseResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const productId = str(o.productId, 40)
  const customerName = str(o.customerName, 80)
  const question = str(o.question, 4000)
  const idempotencyKey = str(o.idempotencyKey, 100)
  if (!productId || !customerName || !question || !idempotencyKey) return { ok: false, error: 'required' }

  const language = oneOf(o.language, INQUIRY_LANGUAGES)
  if (!language) return { ok: false, error: 'invalidLanguage' }

  return { ok: true, value: { productId, customerName, language, question, idempotencyKey } }
}

/** 관리자 답변·번역 텍스트 공통 정리 — 앞뒤 공백 제거, 길이 제한 */
export function sanitizeMessageText(raw: unknown, max = 4000): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : ''
}

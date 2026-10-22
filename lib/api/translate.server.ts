// Upstage Solar Pro 4로 번역한다. Solar 호출 자체(엔드포인트·모델·호출 제한)는 lib/api/solar.server.ts가 맡는다.
import { callSolar as callSolarRaw, SolarError } from './solar.server'

// 앱에서 쓰는 한글 언어 라벨 ↔ 언어 코드 매핑.
// Inquiry.language가 이 라벨들로 저장돼 있어서, API 호출 전에 코드로 변환해야 한다.
export const LANGUAGE_LABEL_TO_CODE: Record<string, string> = {
  한국어: 'ko',
  영어: 'en',
  중국어: 'zh-CN',
  '중국어(번체)': 'zh-TW',
  일본어: 'ja',
  베트남어: 'vi',
}

// 모델에 넘길 언어 이름
const CODE_TO_NAME: Record<string, string> = {
  ko: 'Korean',
  en: 'English',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  ja: 'Japanese',
  vi: 'Vietnamese',
}
const CODES = Object.keys(CODE_TO_NAME)

export class TranslateError extends Error {}

/** 키가 없는 로컬 개발용 가짜 번역 — "[en] 원문". 배포(production)에선 키가 없으면 에러를 낸다 */
const devFallback = () => !process.env.UPSTAGE_API_KEY && process.env.NODE_ENV !== 'production'

/** Solar 호출. 실패 사유는 번역 화면이 쓰던 문구 그대로 TranslateError로 바꿔 던진다 */
async function callSolar<T>(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<T> {
  try {
    return await callSolarRaw<T>(system, user, name, schema)
  } catch (e) {
    if (e instanceof SolarError) {
      throw new TranslateError(e.message.startsWith('UPSTAGE_API_KEY') ? e.message : '번역 서비스 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
    throw e
  }
}

export async function translateText(text: string, targetLabel: string, sourceLabel?: string): Promise<string> {
  const target = LANGUAGE_LABEL_TO_CODE[targetLabel]
  if (!target) {
    throw new TranslateError(`지원하지 않는 언어입니다: ${targetLabel}`)
  }
  const source = sourceLabel ? LANGUAGE_LABEL_TO_CODE[sourceLabel] : undefined
  const [out] = await translateMany([text], target, source)
  return out ?? ''
}

// ── 상품 번역용: 언어 코드(ko, en, ja, zh-CN, zh-TW, vi)를 그대로 받아 여러 글을 한 번에 번역한다 ──

// 한 요청에 너무 많이 넣으면 순서가 밀리거나 잘리기 쉬워서 작게 나눈다
const BATCH_COUNT = 30
const BATCH_CHARS = 4000

const TRANSLATIONS_SCHEMA = {
  type: 'object',
  properties: { translations: { type: 'array', items: { type: 'string' } } },
  required: ['translations'],
  additionalProperties: false,
}

async function translateBatch(texts: string[], target: string, source?: string | null): Promise<string[]> {
  const to = CODE_TO_NAME[target] ?? target
  const from = source ? (CODE_TO_NAME[source] ?? source) : null
  const system = [
    `You are a professional translator for a Japan travel product catalog. Translate each string ${from ? `from ${from} ` : ''}into ${to}.`,
    'Return {"translations": [...]} with exactly one translation per input string, in the same order.',
    'Keep line breaks, numbers, prices, times, URLs and proper nouns as they are. Do not add explanations.',
    `If a string is already in ${to}, return it unchanged.`,
  ].join('\n')
  const data = await callSolar<{ translations: string[] }>(system, JSON.stringify(texts), 'translations', TRANSLATIONS_SCHEMA)
  if (data.translations.length !== texts.length) {
    console.error(`Upstage 번역 개수 불일치: 보낸 ${texts.length}개, 받은 ${data.translations.length}개`)
    throw new TranslateError('번역 결과가 올바르지 않습니다. 다시 시도해 주세요.')
  }
  return data.translations
}

/** texts를 target 언어로. 결과는 같은 순서. source를 모르면 모델이 알아서 판단한다 */
export async function translateMany(texts: string[], target: string, source?: string | null): Promise<string[]> {
  if (texts.length === 0) return []
  if (devFallback()) return texts.map((t) => `[${target}] ${t}`)

  const out: string[] = []
  let batch: string[] = []
  let chars = 0
  const flush = async () => {
    if (!batch.length) return
    out.push(...(await translateBatch(batch, target, source)))
    batch = []
    chars = 0
  }
  for (const t of texts) {
    if (batch.length >= BATCH_COUNT || (batch.length && chars + t.length > BATCH_CHARS)) await flush()
    batch.push(t)
    chars += t.length
  }
  await flush()
  return out
}

/** 글의 언어 코드(ko, en, ja, zh-CN …). 모르면 null */
export async function detectLanguage(text: string): Promise<string | null> {
  if (!text.trim()) return null
  if (devFallback()) {
    // 키 없는 로컬: 글자 종류로만 대충 본다
    if (/[가-힣]/.test(text)) return 'ko'
    if (/[ぁ-ゟ゠-ヿ]/.test(text)) return 'ja'
    if (/[一-鿿]/.test(text)) return 'zh-CN'
    return 'en'
  }
  const data = await callSolar<{ language: string }>(
    'Identify the main language of the text. Answer "other" if it is none of the listed languages.',
    text.slice(0, 1000),
    'language',
    {
      type: 'object',
      properties: { language: { type: 'string', enum: [...CODES, 'other'] } },
      required: ['language'],
      additionalProperties: false,
    },
  )
  return CODES.includes(data.language) ? data.language : null
}

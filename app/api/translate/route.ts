// 문의 화면의 "원문 자동번역 생성" (화면 내부용). 번역은 BE 가 한다 (POST /api/v1/inquiries/translate) — Upstage 키는 BE 에만 있다.
import { forward } from '@/lib/api/backend'

export type TranslateRequestBody = {
  text: string
  targetLang: string // '한국어' | '영어' | '중국어' | '일본어' | '베트남어'
  sourceLang?: string
}

export type TranslateResponseBody = {
  translatedText: string
}

export async function POST(request: Request) {
  return forward('/api/v1/inquiries/translate', await request.text())
}

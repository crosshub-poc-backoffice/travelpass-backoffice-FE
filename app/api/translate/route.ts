import { NextResponse } from 'next/server'
import { TranslateError, translateText } from '@/lib/api/translate.server'
import { requireApiSession } from '@/lib/api/session.server'

export type TranslateRequestBody = {
  text: string
  targetLang: string // '한국어' | '영어' | '중국어' | '일본어' | '베트남어'
  sourceLang?: string
}

export type TranslateResponseBody = {
  translatedText: string
}

export async function POST(request: Request) {
  // 로그인한 관리자만. 열어두면 밖에서 우리 번역 API 비용으로 호출할 수 있다
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response

  const body = (await request.json()) as TranslateRequestBody

  if (!body.text?.trim() || !body.targetLang) {
    return NextResponse.json({ error: 'text와 targetLang은 필수입니다.' }, { status: 400 })
  }

  try {
    const translatedText = await translateText(body.text, body.targetLang, body.sourceLang)
    const response: TranslateResponseBody = { translatedText }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof TranslateError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return NextResponse.json({ error: '번역 중 알 수 없는 오류가 발생했습니다.' }, { status: 500 })
  }
}

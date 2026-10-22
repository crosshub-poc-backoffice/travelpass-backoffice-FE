'use server'

import { refresh } from 'next/cache'
import { hasLocale } from 'next-intl'
import { routing } from '@/i18n/routing'
import type { ErrorKey } from '@/lib/errors'
import { sanitizeMessageText } from '@/lib/inquiries/validate'
import { postAnswer, saveMessageTranslation } from '@/lib/server/inquiries/service'
import { requireMenu } from '@/lib/server/auth/session'

export type ActionState = { error?: ErrorKey }

// locale: 답변을 쓴 관리자의 화면 언어 (= text의 언어)
export async function answerInquiry(inquiryId: string, text: string, textTranslated: string, locale: string): Promise<ActionState> {
  const user = await requireMenu('inquiries', 'edit', 'create')
  const cleanText = sanitizeMessageText(text)
  if (!cleanText || !hasLocale(routing.locales, locale)) return { error: 'required' }

  // 번역 없이 등록하면 고객은 답변을 못 읽는다 — 자동번역 생성을 반드시 거치게 한다.
  const cleanTranslated = sanitizeMessageText(textTranslated)
  if (!cleanTranslated) return { error: 'translationRequired' }

  const result = await postAnswer(user, inquiryId, cleanText, cleanTranslated, locale)
  if (!result.ok) return { error: result.error }

  refresh()
  return {}
}

// locale: 번역 목표 언어 = 번역한 관리자의 화면 언어
export async function saveTranslation(messageId: string, textTranslated: string, locale: string): Promise<ActionState> {
  const user = await requireMenu('inquiries', 'edit')
  const cleanText = sanitizeMessageText(textTranslated)
  if (!cleanText || !hasLocale(routing.locales, locale)) return { error: 'required' }

  const result = await saveMessageTranslation(user, messageId, cleanText, locale)
  if (!result.ok) return { error: result.error }

  refresh()
  return {}
}

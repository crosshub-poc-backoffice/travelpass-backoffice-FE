import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

type Messages = { [key: string]: string | Messages }

async function loadMessages(locale: string): Promise<Messages> {
  return (await import(`../messages/${locale}.json`)).default
}

// 번역이 아직 안 된 키는 기본 언어(한국어) 문구로 채운다.
// 4단계(본문 전체 번역)가 후속 작업으로 분리돼 있어서, 당분간 비영어권 로케일에
// 빈 키가 많을 수밖에 없다 — 빈 문자열 대신 한국어라도 보여주기 위한 안전장치.
function withFallback(fallback: Messages, messages: Messages): Messages {
  const merged: Messages = { ...fallback }
  for (const [key, value] of Object.entries(messages)) {
    const base = fallback[key]
    merged[key] = typeof value === 'object' && typeof base === 'object' ? withFallback(base, value) : value
  }
  return merged
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  const messages = await loadMessages(locale)

  return {
    locale,
    messages:
      locale === routing.defaultLocale ? messages : withFallback(await loadMessages(routing.defaultLocale), messages),
  }
})

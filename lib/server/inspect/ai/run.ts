// Solar에게 상품 본문을 보여주고 항목별로 판정을 받는다.
//
// 설계 원칙 (docs/상품검수-AI-파이프라인-설계.md):
//  1. 자유 서술 금지 — 항목마다 ok/issue/unsure 와 근거 인용만 받는다
//  2. 근거 인용이 원문에 실제로 없으면 그 지적을 버린다 (환각 차단)
//  3. unsure를 허용한다 — 억지로 한쪽을 고르게 하면 오탐이 는다
//  4. 항목 전부를 한 번에 묻는다
import { callSolar, solarConfigured, SolarError } from '@/lib/api/solar.server'
import type { ProductInput } from '@/lib/products/types'
import type { Checker, Finding } from '../types'
import { QUESTIONS, questionsSchema } from './questions'

// 긴 상품은 앞쪽만 본다. 토큰이 곧 비용이고 지연이다
const MAX_BODY_CHARS = 6000

type Answer = { status: 'ok' | 'issue' | 'unsure'; quote: string; note: string }

const CATEGORY_LABEL: Record<string, string> = {
  tour: '관광·체험',
  lodging: '숙박',
  transport: '교통',
  package: '패키지',
  other: '기타',
}

/** 모델이 본문과 대조할 "입력된 값" */
function renderFields(p: ProductInput): string {
  const lines: string[] = []
  lines.push(`상품 종류: ${CATEGORY_LABEL[p.category] ?? p.category}`)
  lines.push(`예약 마감: 출발 ${p.deadlineDays}일 전 ${p.deadlineTime}까지`)
  lines.push(`예약 확정: ${p.confirmType === 'instant' ? '즉시 확정' : '업체 견적 후 확정'}`)

  if (p.cancelRules.length) {
    const rules = p.cancelRules.map((r) => `출발 ${r.daysBefore}일 전까지 취소 시 수수료 ${r.percent}%`).join(' / ')
    lines.push(`취소 규정: ${rules} (그 이후 취소·노쇼는 100%)`)
  } else {
    lines.push('취소 규정: (미입력)')
  }

  const pt = p.priceTable
  for (const plan of pt.plans) {
    const cells = pt.categories
      .map((c) => {
        const v = plan.prices[c.id]
        return typeof v === 'number' ? `${c.name} ${v.toLocaleString('ko-KR')}엔` : null
      })
      .filter(Boolean)
    if (cells.length) lines.push(`요금 [${plan.name || '이름 없음'}]: ${cells.join(', ')}`)
  }
  for (const room of pt.roomTypes) {
    const rate = pt.roomPricing.base[room.id]
    if (rate && typeof rate.price === 'number') lines.push(`객실 요금 [${room.name}]: ${rate.price.toLocaleString('ko-KR')}엔`)
  }
  if (pt.priceText.trim()) lines.push(`요금 참고: ${pt.priceText.trim()}`)

  return lines.join('\n')
}

/** 모델이 읽을 본문 — 이 글 안에서만 근거를 인용하게 한다 */
function renderBody(p: ProductInput): string {
  const parts = [`상품명: ${p.name}`, p.description]
  for (const b of p.blocks) {
    if (b.text.trim()) parts.push(`[${b.title || '섹션'}]\n${b.text}`)
  }
  return parts.filter((s) => s && s.trim()).join('\n\n').slice(0, MAX_BODY_CHARS)
}

const squash = (s: string) => s.replace(/\s+/g, '')

function systemPrompt(): string {
  return [
    '너는 일본 여행 상품 카탈로그의 심사 보조다. 아래 항목만 판정한다.',
    '각 항목에 status(ok/issue/unsure), quote, note를 채워라.',
    '- quote는 [상품 본문]에서 한 글자도 바꾸지 말고 그대로 옮긴다. 요약·의역 금지.',
    '- 본문에서 그대로 인용할 근거를 찾을 수 없으면 status는 ok로 한다. 추측으로 issue를 만들지 마라.',
    '- 판단이 애매하면 issue가 아니라 unsure를 쓴다.',
    '- note는 한국어 한 문장. 근거가 없으면 빈 문자열.',
    '',
    ...QUESTIONS.map((q) => `${q.key}: ${q.criteria}`),
  ].join('\n')
}

/** 상품 본문을 Solar에 한 번 보내고, 항목별 지적을 Finding으로 돌려준다 */
export const aiChecker: Checker = {
  code: 'AI',
  kind: 'ai',
  appliesTo: (t) => solarConfigured() && renderBody(t.proposed).trim().length > 0,
  run: async (t) => {
    const body = renderBody(t.proposed)
    const user = `[입력된 값]\n${renderFields(t.proposed)}\n\n[상품 본문]\n${body}`

    let answers: Record<string, Answer>
    try {
      answers = await callSolar<Record<string, Answer>>(systemPrompt(), user, 'product_inspection', questionsSchema())
    } catch (e) {
      // AI가 실패해도 규칙 결과는 살아야 한다 — 여기서 삼키고 빈 배열을 돌려준다
      console.error('[inspect] Solar 검수 실패', e instanceof SolarError ? e.message : e)
      return []
    }

    const haystack = squash(body)
    const out: Finding[] = []
    for (const q of QUESTIONS) {
      const a = answers[q.key]
      if (!a || a.status === 'ok') continue
      const quote = (a.quote ?? '').trim()
      // 원칙 2 — 원문에 없는 근거는 환각으로 보고 버린다
      if (!quote || !haystack.includes(squash(quote))) continue
      out.push({
        code: q.code,
        severity: a.status === 'unsure' ? 'low' : q.severity,
        source: 'ai',
        field: q.field,
        evidence: { quote, note: (a.note ?? '').trim(), unsure: a.status === 'unsure' },
      })
    }
    return out
  },
}

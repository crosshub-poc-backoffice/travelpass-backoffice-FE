// Solar에게 물을 항목들. 항목마다 따로 호출하지 않고 하나의 스키마로 합쳐 1회만 부른다
// (항목마다 부르면 비용·지연이 항목 수만큼 곱해진다).
//
// 항목을 늘리기 전에 정확도를 먼저 본다 — 설계 문서의 "AI 설계 다섯 원칙" 5번.

import type { Severity } from '../types'

export type Question = {
  /** 응답 JSON의 키 */
  key: string
  /** Finding.code */
  code: string
  severity: Severity
  /** 어디를 가리키는 지적인지 */
  field: string
  /** 시스템 프롬프트에 들어갈 판정 기준 */
  criteria: string
}

export const QUESTIONS: Question[] = [
  {
    key: 'text_field_mismatch',
    code: 'TEXT_FIELD_MISMATCH',
    severity: 'high',
    field: 'description',
    criteria: [
      '[본문 ↔ 입력값 불일치]',
      '아래 "입력된 값"과 본문의 서술이 서로 다른 말을 하는 곳을 찾아라.',
      '예: 입력된 취소규정은 "3일 전 50%"인데 본문에 "3일 전까지 무료 취소"라고 적힌 경우.',
      '예: 입력된 성인 요금이 15,000엔인데 본문에 "대인 12,000엔"이라고 적힌 경우.',
      '예: 입력된 예약 마감이 1일 전인데 본문에 "당일 예약 가능"이라고 적힌 경우.',
      '같은 내용을 다르게 표현한 것(예: "180분"과 "3시간")은 불일치가 아니다.',
      '본문에 그런 서술 자체가 없으면 ok다. 없는 것은 불일치가 아니다.',
    ].join(' '),
  },
  {
    key: 'external_contact',
    code: 'EXTERNAL_CONTACT',
    severity: 'high',
    field: 'description',
    criteria: [
      '[플랫폼 우회 유도]',
      '본문이 이 플랫폼을 거치지 않고 업체에 직접 예약·결제하도록 유도하는지 보라.',
      '예: "예약은 저희 홈페이지에서", "전화로 문의주시면 할인", 외부 예약 사이트 주소.',
      '집합 장소 안내, 현장 비상 연락처, 업체 소개 목적의 주소는 정상이다 — ok로 본다.',
    ].join(' '),
  },
]

/** strict JSON schema. 항목마다 status·quote·note 세 칸 */
export function questionsSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const q of QUESTIONS) {
    properties[q.key] = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'issue', 'unsure'] },
        quote: { type: 'string', description: '본문에서 그대로 옮긴 근거 문구. 없으면 빈 문자열' },
        note: { type: 'string', description: '무엇이 어긋나는지 한 문장. 없으면 빈 문자열' },
      },
      required: ['status', 'quote', 'note'],
      additionalProperties: false,
    }
  }
  return { type: 'object', properties, required: QUESTIONS.map((q) => q.key), additionalProperties: false }
}

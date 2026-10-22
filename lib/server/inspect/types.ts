// 상품 검수 파이프라인의 공용 타입.
//
// 이 폴더(ai/ 제외)는 일부러 다음을 import하지 않는다 — 설계 문서 docs/상품검수-AI-파이프라인-설계.md 참고.
//   - prisma: 데이터를 "받아서" 본다. 그래야 외부가 HTTP로 던진 값에도 같은 코드가 돈다
//   - next/*: 순수 TS로 두면 나중에 폴더째 옮길 수 있다
//   - 로그인·권한: 입구(Server Action·Route Handler)마다 각각 확인한다
//   - 사람이 읽을 문장: code와 근거 값만 만든다. 문구는 messages/<언어>.json에서 조립한다

import type { ProductInput } from '@/lib/products/types'

export type Severity = 'low' | 'medium' | 'high'

/** 검수에서 걸린 것 하나. message는 넣지 않는다 — 화면이 code로 문구를 찾는다 */
export type Finding = {
  /** 고정 문자열. 화면·외부 호출자는 이걸로 분기한다 */
  code: string
  severity: Severity
  /** rule = 계산으로 확정, ai = 확률적 판단 */
  source: 'rule' | 'ai'
  /** 문제 위치 (ProductInput 기준 경로) */
  field?: string
  /** 왜 그렇게 봤는지. 화면이 그대로 보여줘서 심사자가 1초 만에 확인하게 한다 */
  evidence?: Record<string, unknown>
}

/** 검수 대상. current가 null이면 최초 심사, 있으면 변경요청(전/후 비교) */
export type InspectTarget = {
  kind: 'product'
  current: ProductInput | null
  proposed: ProductInput
}

export type Checker = {
  code: string
  kind: 'rule' | 'ai'
  appliesTo: (t: InspectTarget) => boolean
  run: (t: InspectTarget) => Promise<Finding[]>
}

export type Verdict = 'pass' | 'warn' | 'review'

export type InspectResult = {
  verdict: Verdict
  findings: Finding[]
  /** AI 검사를 실제로 돌렸는지. 키가 없거나 꺼져 있으면 false */
  aiRan: boolean
}

/** 규칙 검사기를 짧게 만드는 도우미 */
export function ruleChecker(code: string, run: (t: InspectTarget) => Finding[], appliesTo?: (t: InspectTarget) => boolean): Checker {
  return {
    code,
    kind: 'rule',
    appliesTo: appliesTo ?? (() => true),
    run: async (t) => run(t),
  }
}

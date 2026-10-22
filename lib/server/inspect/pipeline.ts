// 파이프라인 본체. 넘겨받은 검사기를 대상에 맞게 골라 돌리고 결과를 합친다.
// DB·로그인·화면 문구를 모른다 — 입구(Server Action·Route Handler)가 맡는다.
// registry.ts를 여기서 import하지 않는 이유: registry가 AI 검사기를 통해 server-only를 끌고 와서
// 이 파일까지 서버 전용이 된다. 검사기 목록은 부르는 쪽이 넘긴다 (CHECKERS).
import type { Checker, Finding, InspectResult, InspectTarget, Verdict } from './types'

function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === 'high')) return 'review'
  return findings.length ? 'warn' : 'pass'
}

export type RunOptions = {
  /** false면 AI 검사를 건너뛴다 (규칙만, 즉답) */
  ai?: boolean
}

/** 대상 하나를 검수한다. 검사기 하나가 터져도 나머지는 살린다 */
export async function runInspection(target: InspectTarget, checkers: Checker[], { ai = true }: RunOptions = {}): Promise<InspectResult> {
  const picked = checkers.filter((c) => (ai || c.kind === 'rule') && c.appliesTo(target))

  // 규칙 먼저 — 산수라 즉시 끝난다. AI는 그 뒤에(solar.server.ts가 호출을 줄 세운다)
  const rules = picked.filter((c) => c.kind === 'rule')
  const ais = picked.filter((c) => c.kind === 'ai')

  const findings: Finding[] = []
  const runOne = async (c: Checker) => {
    try {
      findings.push(...(await c.run(target)))
    } catch (e) {
      console.error(`[inspect] 검사기 실패: ${c.code}`, e)
    }
  }

  await Promise.all(rules.map(runOne))
  for (const c of ais) await runOne(c)

  const order = { high: 0, medium: 1, low: 2 } as const
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { verdict: verdictOf(findings), findings, aiRan: ais.length > 0 }
}

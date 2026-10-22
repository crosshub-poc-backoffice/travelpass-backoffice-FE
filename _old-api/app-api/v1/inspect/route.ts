// 상품 검수 판정 창구. 로그인 세션이 아니라 x-api-key 헤더로 인증한다.
// 받은 데이터만 보고 판정한다 — DB를 읽지 않으므로 "같은 업체의 다른 상품과 비교" 같은 검사는 할 수 없다.
import { NextResponse } from 'next/server'
import type { ApiError } from '@/lib/api/contract'
import { requireApiKey } from '@/lib/api/v1-auth.server'
import { parseProductInput } from '@/lib/products/validate'
import { runInspection } from '@/lib/server/inspect/pipeline'
import { CHECKERS } from '@/lib/server/inspect/registry'
import type { Finding, Verdict } from '@/lib/server/inspect/types'

// AI 모드는 Solar 응답을 기다린다
export const maxDuration = 300

// AI를 켜면 한 건당 수 초가 걸린다. 많이 보내면 타임아웃이므로 아예 거절한다
const MAX_ITEMS = { fast: 50, full: 5 } as const

type Item = { ref?: unknown; payload?: unknown }
type Body = { type?: unknown; mode?: unknown; items?: unknown }

export type InspectResponseItem = { ref: string | null; verdict: Verdict; findings: Finding[] } | { ref: string | null; error: 'INVALID_PAYLOAD' }
export type InspectResponse = { mode: 'fast' | 'full'; results: InspectResponseItem[] }

const bad = (error: string, code: ApiError['code'] = 'VALIDATION_ERROR', status = 400) => NextResponse.json<ApiError>({ error, code }, { status })

export async function POST(request: Request) {
  const denied = requireApiKey(request)
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body !== 'object') return bad('본문이 올바른 JSON이 아닙니다.')

  if (body.type !== undefined && body.type !== 'product') return bad(`지원하지 않는 type입니다: ${String(body.type)}`)

  const mode: 'fast' | 'full' = body.mode === 'full' ? 'full' : 'fast'
  const items = Array.isArray(body.items) ? (body.items as Item[]) : null
  if (!items?.length) return bad('items가 비어 있습니다.')
  if (items.length > MAX_ITEMS[mode]) {
    return bad(`mode=${mode}에서는 한 번에 ${MAX_ITEMS[mode]}건까지 보낼 수 있습니다. (받은 건수: ${items.length})`)
  }

  const results: InspectResponseItem[] = []
  for (const item of items) {
    const ref = typeof item?.ref === 'string' ? item.ref : null
    const parsed = parseProductInput(item?.payload, { draft: true })
    if (!parsed.ok) {
      results.push({ ref, error: 'INVALID_PAYLOAD' })
      continue
    }
    // 외부 호출에는 지금 상품이 없다 — 전/후 비교 검사는 돌지 않는다
    const result = await runInspection({ kind: 'product', current: null, proposed: parsed.value }, CHECKERS, { ai: mode === 'full' })
    results.push({ ref, verdict: result.verdict, findings: result.findings })
  }

  return NextResponse.json<InspectResponse>({ mode, results })
}

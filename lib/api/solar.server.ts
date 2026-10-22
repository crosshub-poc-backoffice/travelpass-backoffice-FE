// Upstage Solar(OpenAI 호환 Chat Completions) 공용 호출.
// 번역·상품검수 등 Solar를 쓰는 모든 기능이 이 파일 하나를 지난다.
// API 키는 여기서만 읽고 클라이언트로 내려보내지 않는다 — 서버에서만 import할 것.
import 'server-only'

const ENDPOINT = 'https://api.upstage.ai/v1/chat/completions'
const MODEL = 'solar-pro4'

export class SolarError extends Error {}

/** 키가 있으면 true. 없으면 호출하는 쪽이 건너뛸지 에러를 낼지 정한다 */
export const solarConfigured = () => Boolean(process.env.UPSTAGE_API_KEY)

// Solar의 실제 호출 제한을 아직 모른다(docs/upstage-api.md의 1 RPS는 문서 추출 전용).
// 확인 전까지는 한 번에 하나씩만 보낸다 — 번역·검수가 동시에 돌아도 서로 밀치지 않는다.
// 제한이 확인되면 SOLAR_MIN_INTERVAL_MS만 조정하면 된다.
const MIN_INTERVAL_MS = Number(process.env.SOLAR_MIN_INTERVAL_MS ?? 0)
let queue: Promise<unknown> = Promise.resolve()
let lastCallAt = 0

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      return await fn()
    } finally {
      lastCallAt = Date.now()
    }
  })
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Solar 호출. 응답은 schema 모양의 JSON으로 받는다 (Structured outputs). 추론은 끈 채로(reasoning_effort 생략) */
export function callSolar<T>(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<T> {
  return serialize(async () => {
    const apiKey = process.env.UPSTAGE_API_KEY
    if (!apiKey) throw new SolarError('UPSTAGE_API_KEY가 설정되지 않았습니다.')
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    })
    if (!res.ok) {
      // 원문 에러(키·쿼터 등 내부 정보 포함 가능)는 서버 로그에만 남기고, 호출한 쪽에는 일반 메시지만 돌려준다.
      console.error(`Upstage API 호출 실패 (${res.status}): ${await res.text()}`)
      throw new SolarError('AI 서비스 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
    const json = (await res.json()) as { choices: { message: { content: string | null }; finish_reason: string }[] }
    const choice = json.choices[0]
    if (!choice?.message.content || choice.finish_reason === 'length') {
      console.error(`Upstage 응답이 비었거나 잘림 (finish_reason: ${choice?.finish_reason})`)
      throw new SolarError('AI 서비스 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    }
    return JSON.parse(choice.message.content) as T
  })
}

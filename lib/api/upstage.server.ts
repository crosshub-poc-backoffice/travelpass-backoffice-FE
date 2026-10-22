// Upstage 문서 AI 서버 사이드 호출 (상품 소개서 → 등록 화면 초안).
// API 키는 여기서만 쓰고 클라이언트로 절대 내려보내지 않는다 — 그래서 반드시 서버(route handler)에서만 import할 것.
//
// 번역(translate.server.ts)과 키를 나눠 쓸 수 있다. 번역은 토큰 과금, 문서는 페이지 과금이라
// 한 키로 묶으면 어느 쪽이 크레딧을 썼는지 구분되지 않는다. 전용 키가 없으면 번역 키를 같이 쓴다.
//
// Universal Extraction — 파일과 JSON Schema를 주면 그 모양대로 값을 뽑아준다 (OpenAI 호환 REST).
// 레이아웃·OCR·표 인식을 이 API가 안에서 다 한다. 따로 파싱해서 넘길 필요가 없다.

const EXTRACT_ENDPOINT = 'https://api.upstage.ai/v1/information-extraction/chat/completions'

export class UpstageError extends Error {}

/** 소개서에서 뽑아낸 값. id가 없는 평면 구조 — 기준은 이름으로 가리킨다.
 *  (Plan.prices가 category.id를 키로 써서, id는 extract-map.ts가 붙인다)
 *  요금표를 칸 단위(plan × category)로 펴서 받는다 — Universal Extraction이 배열 안의 배열을 받지 않는다 */
export type ExtractedProduct = {
  productName: string
  description: string
  priceRows: { plan: string; category: string; yen: number | null }[]
  priceNote: string
  cancelRules: { daysBefore: number; percent: number }[]
  sections: { kind: string; title: string; text: string }[]
}

/** 뽑을 값의 모양. description은 모델에게 보내는 프롬프트이고 정확도를 좌우하는 가장 큰 레버다
 *  (docs/upstage-api.md 참고 — 위치 지정·포함/제외·형식 요구·혼동 방지·정규화 다섯 용도로 쓴다).
 *  객체의 속성이 "객체의 배열"이면 거부당하므로 중첩은 한 단계로만 유지한다 */
const SCHEMA = {
  type: 'object',
  properties: {
    productName: {
      type: 'string',
      description:
        '상품 이름. 보통 문서 첫 장의 가장 큰 제목이다. 회사명·업체명·"여행 안내" 같은 문서 종류 이름이 아니라 파는 상품의 이름. 플랜 이름(2박 3일 등)도 아니다',
    },
    description: {
      type: 'string',
      description:
        '상품을 한두 문장으로 소개하는 글. 문서 앞부분의 소개 문단, 여행지를 설명하는 글("~에 대해" 같은 제목이 붙은 부분)은 모두 여기에 모아 쓴다. 없으면 빈 문자열',
    },
    priceRows: {
      type: 'array',
      description:
        '요금표를 칸 하나씩 펼친 목록. 행(기간·코스)이 3개이고 열(성인·아동)이 2개면 6칸이므로 6개를 넣는다. ' +
        '여러 요금표가 있으면 전부 포함한다. 단, 옵션 추가요금표·취소 수수료표·환율표는 요금표가 아니므로 넣지 않는다. ' +
        '"총액"·"합계"처럼 다른 칸을 더한 값, 할인 전 정가(취소선 금액)도 넣지 않는다. 금액이 비어 있거나 "-"인 칸은 넣지 않는다',
      items: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description:
              '그 칸이 속한 행의 이름. 기간·코스·객실·출발일 등. 예: 2박 3일, 7~8월, 스탠다드, 평일. ' +
              '한 칸이 여러 행에 걸쳐 병합되어 있으면 그 행들 각각에 같은 이름을 반복해서 넣는다. 행 구분이 없는 표면 빈 문자열',
          },
          category: {
            type: 'string',
            description:
              '그 칸이 속한 열의 이름(인원 구분). 예: 성인, 아동, 유아, 소인 / 大人, 小人, 中学生, 幼児 / Adult, Child, Infant. ' +
              '표에 쓰인 말을 그대로 쓴다. 번역하거나 바꾸지 않는다. 인원 구분 열이 없으면 빈 문자열',
          },
          yen: {
            type: 'number',
            description:
              '그 칸의 1인 단가를 숫자만. ¥48,000 · 48,000円 · 48000엔 · 4.8万 은 모두 48000. ' +
              '세금 포함가와 별도가가 같이 적혀 있으면 세금 포함가를 쓴다. 범위로 적혀 있으면(48,000~52,000) 낮은 쪽을 쓴다',
          },
        },
      },
    },
    priceNote: {
      type: 'string',
      description: '요금에 붙는 참고 사항. 포함·불포함 내역, 세금·유류할증료 안내, 최소 출발 인원 등. 취소 수수료 내용은 여기 넣지 않는다',
    },
    sections: {
      type: 'array',
      description:
        '일정·프로그램·교통·숙박 네 가지에 해당하는 안내만. 문서의 모든 소제목을 넣는 것이 아니다. ' +
        '여행지 소개·상품 소개 문구는 description에 쓰고 여기에는 다시 넣지 않는다. ' +
        '요금표·취소 수수료·예약 방법·회사 소개·연락처도 넣지 않는다. 해당하는 것이 없으면 빈 배열',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description:
              '이 묶음의 종류를 다음 다섯 중 하나로. ' +
              'itinerary = 날짜·시간순 일정(일정표, 行程表, 1일차/2일차, Day 1). ' +
              'program = 현지에서 하는 체험·활동 내용(프로그램, プログラム, 체험, 액티비티). ' +
              'transport = 교통편·차량·항공 안내. ' +
              'lodging = 숙박시설·객실 안내. ' +
              '네 가지 중 어디에도 맞지 않으면 그 묶음은 아예 넣지 않는다',
          },
          title: { type: 'string', description: '문서에 적힌 소제목을 그대로. 소제목이 없으면 빈 문자열' },
          text: {
            type: 'string',
            description:
              '그 묶음의 본문을 읽기 좋게 정리해서. 줄바꿈은 유지한다. 표가 있으면 "항목: 값" 형태의 줄로 편다. ' +
              '금액·취소 수수료는 다른 항목에서 따로 뽑으므로 여기에 중복해서 넣지 않는다',
          },
        },
      },
    },
    cancelRules: {
      type: 'array',
      description:
        '취소 수수료 규정. "출발 7일 전까지 30%" 같은 조건을 한 줄씩. 위약금·해약금·キャンセル料 표현도 같은 것으로 본다. ' +
        '"그 이후 100%"·"노쇼 100%"처럼 마지막을 덮는 줄은 넣지 않는다 (화면이 자동으로 붙인다)',
      items: {
        type: 'object',
        properties: {
          daysBefore: {
            type: 'number',
            description: '이용일(출발일) 기준 며칠 전인지. "당일"·"출발일"은 0. "1개월 전"은 30. 날짜가 아니라 일수로',
          },
          percent: { type: 'number', description: '수수료 비율을 0~100 사이 숫자로. "30%"는 30. 금액(10,000원)으로만 적혀 있으면 그 줄은 넣지 않는다' },
        },
      },
    },
  },
}

/** 문서용 키. 전용 키(UPSTAGE_DOCS_API_KEY)가 있으면 그걸 쓰고, 없으면 번역용 키를 같이 쓴다.
 *  전용 키를 두는 이유는 과금 구분(번역=토큰, 문서=페이지)이라 섞여도 동작에는 문제가 없다 */
const docsKey = () => process.env.UPSTAGE_DOCS_API_KEY || process.env.UPSTAGE_API_KEY

/** 키가 없는 로컬 개발용 가짜 추출 — 크레딧을 쓰지 않고 화면을 만들 수 있다. 배포(production)에선 키가 없으면 에러를 낸다 */
const devFallback = () => !docsKey() && process.env.NODE_ENV !== 'production'

const SAMPLE: ExtractedProduct = {
  productName: '[샘플] 후지산 버스 투어 2박 3일',
  description: '도쿄 출발, 후지산과 하코네를 도는 2박 3일 일정',
  priceRows: [
    { plan: '2박 3일', category: '성인', yen: 48000 },
    { plan: '2박 3일', category: '아동', yen: 32000 },
    { plan: '3박 4일', category: '성인', yen: 62000 },
    { plan: '3박 4일', category: '아동', yen: 41000 },
  ],
  priceNote: '숙박·조식·가이드 포함. 개인 경비는 불포함입니다.',
  cancelRules: [
    { daysBefore: 7, percent: 30 },
    { daysBefore: 3, percent: 50 },
    { daysBefore: 1, percent: 80 },
  ],
  sections: [
    { kind: 'itinerary', title: '일정표', text: '1일차 도쿄 출발 → 하코네 도착\n2일차 후지산 5합목\n3일차 귀환' },
    { kind: 'program', title: '체험 프로그램', text: '온천 체험, 유람선 승선' },
  ],
}

function apiKey(): string {
  const key = docsKey()
  if (!key) throw new UpstageError('UPSTAGE_DOCS_API_KEY(또는 UPSTAGE_API_KEY)가 설정되지 않았습니다. .env를 확인하세요.')
  return key
}

/** 호출 실패를 화면에 보여줄 말로 바꾼다. 원문 에러(키·쿼터 등 내부 정보가 섞일 수 있다)는 서버 로그에만 남긴다 */
async function fail(res: Response): Promise<never> {
  console.error(`Upstage Universal Extraction 호출 실패 (${res.status}): ${await res.text()}`)
  // 413·415·422는 파일 쪽 문제라 다시 눌러도 결과가 같다 — 무엇을 고쳐야 하는지 알려준다
  if (res.status === 413 || res.status === 415 || res.status === 422) {
    throw new UpstageError('문서를 읽을 수 없습니다. 50MB·100페이지 이하의 PDF·HWP·오피스 파일인지 확인해 주세요.')
  }
  throw new UpstageError('문서를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
}

/** 동기 호출은 1초에 1번까지다(docs/upstage-api.md). 업체가 연달아 올리면 429가 나므로 잠깐 쉬고 다시 건다 */
const RETRY_WAITS_MS = [1500, 4000]

async function postExtraction(body: string): Promise<Response> {
  const key = apiKey()
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(EXTRACT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
    })
    if (res.status !== 429 || attempt >= RETRY_WAITS_MS.length) return res
    console.warn(`Upstage rate limit (429). ${RETRY_WAITS_MS[attempt]}ms 뒤 재시도`)
    await new Promise((r) => setTimeout(r, RETRY_WAITS_MS[attempt]))
  }
}

/** 문서를 통째로 넘겨 SCHEMA 모양대로 값을 뽑는다.
 *  Universal Extraction은 파싱된 텍스트가 아니라 파일 자체(base64)를 받는다 — 레이아웃·표 구조를
 *  이 API가 직접 보기 때문에, 미리 텍스트로 바꿔서 넘기면 오히려 표 병합 정보가 사라진다 */
async function extractFields(bytes: Uint8Array, mime: string): Promise<ExtractedProduct> {
  const base64 = Buffer.from(bytes).toString('base64')
  const res = await postExtraction(
    JSON.stringify({
      model: 'information-extract',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
      response_format: { type: 'json_schema', json_schema: { name: 'product_draft', schema: SCHEMA } },
      mode: 'enhanced', // 중첩·병합 셀이 있는 복잡한 표용. 요금표가 정확히 이 대상이다
    }),
  )
  if (!res.ok) await fail(res)

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new UpstageError('문서에서 요금표를 찾지 못했습니다.')
  try {
    return JSON.parse(content) as ExtractedProduct
  } catch {
    console.error(`Upstage 추출 결과가 JSON이 아님: ${content.slice(0, 500)}`)
    throw new UpstageError('문서에서 요금표를 찾지 못했습니다.')
  }
}

/** 키가 없어 가짜 샘플로 돌고 있는지. 화면이 "이건 진짜 추출이 아니다"를 알리는 데 쓴다 —
 *  샘플을 진짜 결과로 오해하면 올리지도 않은 상품이 등록된다 */
export const usingSample = devFallback

/** 소개서 한 건 → 등록 화면 초안. 모양만 맞춰 돌려주고, 값 정리는 extract-map.ts가 한다 */
export async function extractProductDraft(bytes: Uint8Array, mime: string): Promise<ExtractedProduct> {
  if (devFallback()) return SAMPLE
  return extractFields(bytes, mime)
}

// FE 서버가 읽는 설정. 전부 필수 — 코드에 기본값을 두지 않는다 (빠지면 조용히 로컬 주소로 붙는 대신 이름을 알려주고 멈춘다).
// 값은 로컬 .env, 운영은 Vercel 환경변수. 설명은 .env.example
// 시작할 때(instrumentation.ts·scripts/dev.mjs) missingEnv() 로 한 번에 확인하고, 쓰는 곳은 env(이름) 으로 읽는다.
// 일반 JS 라 scripts/dev.mjs(노드 스크립트)와 앱 코드가 같이 쓴다.

export const REQUIRED_ENV = /** @type {const} */ ([
  'BACKEND_API_URL',
  'KEYCLOAK_STAFF_ISSUER_URI',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
  'SESSION_ENCRYPTION_KEY',
  'REDIS_URL',
])

/** 빠졌거나 빈 값인 설정 이름 목록 */
export function missingEnv(source = process.env) {
  return REQUIRED_ENV.filter((name) => !source[name]?.trim())
}

/**
 * 설정 하나. 없으면 바로 실패한다.
 * @param {(typeof REQUIRED_ENV)[number]} name
 * @returns {string}
 */
export function env(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`설정 ${name} 이(가) 없습니다. .env(운영은 Vercel 환경변수)에 넣어 주세요 — 목록은 .env.example`)
  return value
}

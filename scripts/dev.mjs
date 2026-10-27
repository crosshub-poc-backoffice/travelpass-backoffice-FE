// npm run dev: BE 가 떠 있는지 확인 → 로컬 Redis(세션) 켜기 → 개발 서버
// FE 는 DB 에 붙지 않는다 — 데이터는 전부 BE API 로 받는다. 로컬 DB·테이블·데모 데이터는 BE 레포가 맡는다:
//   BE `./gradlew bootRun` 이 로컬 DB 컨테이너를 켜고 Flyway 로 표를 만든다 (BE infra/local/docker-compose.yml)
//   빈 DB 에 데모 데이터: BE `infra/local/demo` 에서 `npm install && npm run seed`
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import { missingEnv } from '../lib/env.mjs'

config({ path: ['.env.local', '.env'], quiet: true })

// 설정이 다 있는지 먼저 본다 — 코드에 기본값이 없다 (lib/env.mjs)
const missing = missingEnv()
if (missing.length > 0) {
  console.error(`\n.env 에 설정이 빠졌습니다 — 목록은 .env.example\n  - ${missing.join('\n  - ')}\n`)
  process.exit(1)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// BE 가 응답하는지만 본다 (토큰 없이 부르면 401 이라도 떠 있는 것). 안 떠 있으면 안내만 하고 계속 — 화면은 BE 가 뜬 뒤에 열면 된다
const backend = process.env.BACKEND_API_URL
try {
  await fetch(`${backend}/api/v1/me`, { signal: AbortSignal.timeout(2000) })
} catch {
  console.warn(`\nBE(${backend})에 접속할 수 없습니다. BE 를 먼저 띄우세요 — 화면 데이터는 전부 BE 에서 온다.`)
  console.warn('  cd ../travelpass-backoffice-BE && ./gradlew bootRun\n')
}

// FE 전용 세션 저장소(Redis). REDIS_URL 이 로컬 주소면 infra/redis 의 컨테이너를 켠다 (운영은 Upstash: rediss://...)
const redisUrl = process.env.REDIS_URL
if (/^rediss?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(redisUrl)) {
  run('docker', ['compose', '-f', 'infra/redis/docker-compose.yml', 'up', '-d', '--wait'])
} else {
  console.log('원격 Redis(REDIS_URL)라 로컬 Redis 는 켜지 않음')
}

run('npx', ['next', 'dev', ...process.argv.slice(2)])

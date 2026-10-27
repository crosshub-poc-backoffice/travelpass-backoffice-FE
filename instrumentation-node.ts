// 필요한 설정이 다 있는지 확인한다. 빠진 게 있으면 이름을 전부 적고 서버를 멈춘다 (lib/env.mjs). instrumentation.ts 가 Node 에서만 부른다
import { missingEnv } from './lib/env.mjs'

const missing = missingEnv()
if (missing.length > 0) {
  console.error(`\n설정이 빠졌습니다. .env(운영은 Vercel 환경변수)를 확인하세요 — 목록은 .env.example\n  - ${missing.join('\n  - ')}\n`)
  process.exit(1)
}
if (Buffer.from(process.env.SESSION_ENCRYPTION_KEY ?? '', 'base64').length !== 32) {
  console.error('\nSESSION_ENCRYPTION_KEY 는 32바이트 base64 여야 합니다 (openssl rand -base64 32)\n')
  process.exit(1)
}

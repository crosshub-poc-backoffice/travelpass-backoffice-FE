// Vercel이 production(main)을 배포할 때만 Supabase에 마이그레이션을 적용한다.
// Preview 배포·로컬 빌드는 건너뛴다. 실패하면 빌드가 멈추고 이전 배포가 그대로 유지된다.
import { execSync } from 'node:child_process'

if (process.env.VERCEL_ENV === 'production') {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
} else {
  console.log('마이그레이션 건너뜀 (Vercel production 배포가 아님)')
}

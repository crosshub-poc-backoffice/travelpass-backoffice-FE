// npm run dev: 로컬 DB 켜기 → 밀린 마이그레이션 적용 → Prisma Client 생성 → 테스트 계정 맞추기 → 개발 서버
// 동료 코드를 받은 뒤에도 이것만 실행하면 된다. DB 단계는 로컬 DB(localhost)일 때만 한다 (원격 DB는 건드리지 않음).
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'], quiet: true })

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/travelpass'
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)

if (isLocal) {
  run('docker', ['compose', 'up', '-d', '--wait']) // Docker Desktop이 켜져 있어야 한다
  run('npx', ['prisma', 'migrate', 'deploy']) // 커밋된 마이그레이션 중 로컬에 없는 것만 적용
  run('npx', ['prisma', 'generate'])
  run('npx', ['prisma', 'db', 'seed']) // 테스트 계정·업체를 기본값으로 맞춘다 (여러 번 돌려도 같음)
} else {
  console.log('원격 DB라 DB 준비 단계를 건너뜀')
  run('npx', ['prisma', 'generate'])
}

run('npx', ['next', 'dev', ...process.argv.slice(2)])

// npm run dev: 로컬 DB 확인 → 테이블 구조 확인 → Prisma Client 생성 → 테스트 계정 맞추기 → 개발 서버
// 동료 코드를 받은 뒤에도 이것만 실행하면 된다. DB 단계는 로컬 DB(localhost)일 때만 한다 (원격 DB는 건드리지 않음).
// DB의 주인은 BE다 — 로컬 DB 컨테이너는 BE 레포 infra/local/docker-compose.yml로 켜고,
// 테이블 구조는 BE가 기동할 때 Flyway로 만들고 바꾼다 (BE docs/db-ownership-plan.md).
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import pg from 'pg'

config({ path: ['.env.local', '.env'], quiet: true })

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/travelpass'
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)

/** 로컬 DB에 BE(Flyway) 이력 / 옛 Prisma 이력 테이블이 있는지. 접속이 안 되면 null */
async function schemaState() {
  const client = new pg.Client({ connectionString: url })
  try {
    await client.connect()
  } catch {
    return null
  }
  try {
    const { rows } = await client.query(
      "select to_regclass('public.flyway_schema_history') is not null as flyway, to_regclass('public._prisma_migrations') is not null as prisma",
    )
    return rows[0]
  } finally {
    await client.end()
  }
}

if (isLocal) {
  const state = await schemaState()
  if (!state) {
    console.error('\n로컬 DB에 접속할 수 없습니다. BE 레포에서 DB를 먼저 켜세요 (Docker Desktop이 켜져 있어야 한다).')
    console.error('  cd ../travelpass-backoffice-BE/infra/local && docker compose up -d --wait\n')
    process.exit(1)
  }
  if (!state.flyway && state.prisma) {
    // BE가 아직 한 번도 안 뜬 옛 Prisma DB: Prisma 마이그레이션(더는 추가되지 않음)을 끝까지 맞춰 둔다.
    // BE가 다음에 뜰 때 이 구조를 V1(baseline)으로 표시하고, 그 뒤 변경(V2~)은 BE가 적용한다
    run('npx', ['prisma', 'migrate', 'deploy'])
  } else if (!state.flyway) {
    console.error('\n로컬 DB에 테이블이 없습니다. BE를 먼저 한 번 실행하세요 — BE(Flyway)가 테이블을 만듭니다.')
    console.error('  cd ../travelpass-backoffice-BE && ./gradlew bootRun   (.env의 DB_PORT=5433, DB_NAME=travelpass)\n')
    process.exit(1)
  }
  run('npx', ['prisma', 'generate'])
  run('npx', ['prisma', 'db', 'seed']) // 테스트 계정·업체를 기본값으로 맞춘다 (여러 번 돌려도 같음)
} else {
  console.log('원격 DB라 DB 준비 단계를 건너뜀')
  run('npx', ['prisma', 'generate'])
}

run('npx', ['next', 'dev', ...process.argv.slice(2)])

// 빈 DB에만 데모 데이터를 넣는다. 이미 계정이 있으면 아무것도 안 한다 — npm run dev가 켤 때마다 이걸 돌리므로
// 손으로 바꾼 데이터나 데모 데이터를 덮어쓰지 않게. 데이터를 통째로 데모로 되돌리려면 npm run db:demo
// 실행: npm run db:seed (scripts/dev.mjs도 매번 부른다)
import { config } from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'
import { hashPassword } from '../lib/server/auth/password'
import { LOCAL_DATABASE_URL } from '../lib/local-db'
import { fillDemo } from './demo/fill'

config({ path: ['.env.local', '.env'], quiet: true })

// 로컬 DB 테스트 계정의 기본 비밀번호. 로컬 전용이라 코드에 둔다
const LOCAL_SEED_PASSWORD = 'test1234'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? LOCAL_DATABASE_URL
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)

const pool = new Pool({ connectionString: url })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log('이미 데이터가 있어 시드를 건너뜁니다. 데모 데이터로 바꾸려면 npm run db:demo')
    return
  }
  // 로컬이 아닌 DB(Supabase 등)에 넣을 때는 SEED_PASSWORD를 꼭 따로 정해야 한다 (공개된 기본값 금지)
  const seedPassword = process.env.SEED_PASSWORD || (isLocal ? LOCAL_SEED_PASSWORD : '')
  if (seedPassword.length < 8) {
    console.error('로컬 DB가 아니면 SEED_PASSWORD(8자 이상)를 환경변수로 넣어 주세요.')
    process.exitCode = 1
    return
  }
  const passwordHash = await hashPassword(seedPassword)
  const result = await prisma.$transaction((tx) => fillDemo(tx, { passwordHash }), { timeout: 300_000, maxWait: 30_000 })
  console.log('빈 DB에 데모 데이터를 넣었습니다')
  console.table(result)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

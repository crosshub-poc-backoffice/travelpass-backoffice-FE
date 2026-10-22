// 데모 데이터로 DB를 통째로 바꾼다: 모든 데이터 표를 비우고(TRUNCATE) prisma/demo/fill.ts로 다시 채운다.
// 마이그레이션 기록(_prisma_migrations)과 표 구조는 그대로 둔다. 비우기~채우기는 한 트랜잭션이라 실패하면 원래대로 돌아간다.
//
//   로컬:      npm run db:demo
//   Supabase:  DATABASE_URL="<Supabase 주소>" SEED_PASSWORD="<데모 비밀번호>" npm run db:demo -- --target=supabase
//              (실행 중에 "supabase"를 한 번 더 입력해야 진행된다. 모든 로그인 세션도 같이 지워진다)
import { createInterface } from 'node:readline/promises'
import { config } from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'
import { hashPassword } from '../lib/server/auth/password'
import { LOCAL_DATABASE_URL } from '../lib/local-db'
import { fillDemo } from '../prisma/demo/fill'

config({ path: ['.env.local', '.env'], quiet: true })

const LOCAL_SEED_PASSWORD = 'test1234'
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? LOCAL_DATABASE_URL
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
const host = url.replace(/^.*@/, '').replace(/[/?].*$/, '')

async function main() {
  if (!isLocal) {
    if (!process.argv.includes('--target=supabase')) {
      console.error(`로컬 DB가 아닙니다 (${host}). 배포 DB를 바꾸려면 --target=supabase 를 붙여 주세요.`)
      process.exit(1)
    }
    if (!process.env.SEED_PASSWORD || process.env.SEED_PASSWORD.length < 8) {
      console.error('배포 DB에는 SEED_PASSWORD(8자 이상)를 환경변수로 꼭 넣어 주세요. 테스트 계정 3개의 비밀번호가 됩니다.')
      process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(`${host} 의 데이터를 모두 지우고 데모 데이터로 바꿉니다. 계속하려면 supabase 를 입력하세요: `)
    rl.close()
    if (answer.trim() !== 'supabase') {
      console.error('취소했습니다.')
      process.exit(1)
    }
  }

  const pool = new Pool({ connectionString: url })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const passwordHash = await hashPassword(process.env.SEED_PASSWORD || LOCAL_SEED_PASSWORD)
    const result = await prisma.$transaction(
      async (tx) => {
        const tables = await tx.$queryRaw<{ tablename: string }[]>`
          SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
        await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
        return fillDemo(tx, { passwordHash })
      },
      { timeout: 300_000, maxWait: 30_000 },
    )
    console.log(`데모 데이터로 바꿨습니다 (${isLocal ? '로컬' : host})`)
    console.table(result)
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

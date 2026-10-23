// 빈 DB에만 데모 데이터를 넣는다. 이미 계정이 있으면 아무것도 안 한다 — npm run dev가 켤 때마다 이걸 돌리므로
// 손으로 바꾼 데이터나 데모 데이터를 덮어쓰지 않게. 데이터를 통째로 데모로 되돌리려면 npm run db:demo
// 실행: npm run db:seed (scripts/dev.mjs도 매번 부른다)
import { config } from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../lib/generated/prisma/client'
import { LOCAL_DATABASE_URL } from '../lib/local-db'
import { fillDemo } from './demo/fill'

config({ path: ['.env.local', '.env'], quiet: true })

// 테스트 계정(test-crosshub/test-federation/test-partner)의 비밀번호는 Keycloak에 있다 —
// poc-backoffice-BE/infra/keycloak/scripts/reset-password.sh 로 임시 비번을 넣는다.

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? LOCAL_DATABASE_URL
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url)

const pool = new Pool({ connectionString: url })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log('이미 데이터가 있어 시드를 건너뜁니다. 데모 데이터로 바꾸려면 npm run db:demo')
    return
  }
  if (!isLocal) console.log('로컬이 아닌 DB에 데모 데이터를 넣습니다:', url.replace(/^.*@/, '').replace(/[/?].*$/, ''))
  const result = await prisma.$transaction((tx) => fillDemo(tx), { timeout: 300_000, maxWait: 30_000 })
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

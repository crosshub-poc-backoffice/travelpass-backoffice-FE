import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'
import { LOCAL_DATABASE_URL } from './lib/local-db'

// Prisma 7 CLI는 .env를 자동으로 읽지 않음. .env가 없으면 로컬 Docker DB로 붙는다
config({ path: ['.env.local', '.env'], quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // migrate·studio 등 CLI는 풀러를 거치지 않는 주소(DIRECT_URL)를 씀
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? LOCAL_DATABASE_URL },
})

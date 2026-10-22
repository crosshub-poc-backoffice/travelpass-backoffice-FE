// npm run db:migrate: schema.prisma 변경을 SQL 파일로 만들어 로컬 DB에 적용하고 Prisma Client를 다시 만든다.
// 이름을 안 주면 Prisma가 물어본다. (Prisma 7은 migrate dev 뒤에 Client를 자동으로 다시 만들지 않는다)
import { spawnSync } from 'node:child_process'

function run(args) {
  const r = spawnSync('npx', ['prisma', ...args], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(['migrate', 'dev', ...process.argv.slice(2)])
run(['generate'])

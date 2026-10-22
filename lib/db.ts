import 'server-only'
import { Pool } from 'pg'
import { attachDatabasePool } from '@vercel/functions'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
import { LOCAL_DATABASE_URL } from './local-db'

// 개발 중 핫리로드로 커넥션이 계속 늘어나지 않도록 전역에 1개만 유지
const globalForDb = globalThis as unknown as { pool?: Pool; prisma?: PrismaClient }

const pool = globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL })
// Vercel 함수가 쉬기 전에 놀고 있는 커넥션을 정리
attachDatabasePool(pool)

export const prisma = globalForDb.prisma ?? new PrismaClient({ adapter: new PrismaPg(pool) })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
  globalForDb.prisma = prisma
}

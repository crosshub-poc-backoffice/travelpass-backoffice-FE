// Vercel Cron 요청 확인. CRON_SECRET이 비어 있으면 무조건 거절한다
// (비어 있을 때 `Bearer undefined`와 비교하면 그 문자열만 보내도 통과하던 문제를 막는다).
import 'server-only'
import { timingSafeEqual } from 'node:crypto'

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const got = Buffer.from(request.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

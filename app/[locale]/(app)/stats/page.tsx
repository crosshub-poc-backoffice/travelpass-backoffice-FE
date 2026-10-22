import { getLocale } from 'next-intl/server'
import { requireMenu } from '@/lib/server/auth/session'
import { getStats } from '@/lib/server/stats/service'
import { jstToday, shiftMonth } from '@/lib/settlements'
import { StatsView } from './stats-view'

type Params = { from?: string; to?: string }

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 판매 통계. 기본 기간은 최근 6개월 (이번 달 포함). 범위는 로그인 계정이 다룰 수 있는 업체
export default async function StatsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireMenu('stats')
  const sp = await searchParams
  const today = jstToday()
  let from = sp.from && DAY_PATTERN.test(sp.from) ? sp.from : `${shiftMonth(today.slice(0, 7), -5)}-01`
  let to = sp.to && DAY_PATTERN.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]
  // 오늘 뒤는 볼 게 없다. 주소로 미래를 넣어도 오늘까지로 자른다
  if (to > today) to = today
  if (from > to) from = to
  const filter = { from, to }
  const data = await getStats(user, filter, await getLocale())
  return (
    <StatsView
      data={data}
      filter={filter}
      today={today}
      multiPartner={user.managedPartners.length > 1 && !user.activePartnerId}
    />
  )
}

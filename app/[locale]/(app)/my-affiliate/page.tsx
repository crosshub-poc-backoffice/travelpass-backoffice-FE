import { requireMenu } from '@/lib/server/auth/session'
import { getMyAffiliate } from '@/lib/server/payments/service'
import { MyAffiliateView } from './my-affiliate-view'

// 연맹 계정의 "내 연맹 정보". 연맹명·연맹 몫은 보기만, 정산 계좌만 고친다 ("내 업체 정보"와 같은 방식)
export default async function MyAffiliatePage() {
  const user = await requireMenu('myAffiliate')
  const affiliate = await getMyAffiliate(user)
  return <MyAffiliateView affiliate={affiliate} />
}

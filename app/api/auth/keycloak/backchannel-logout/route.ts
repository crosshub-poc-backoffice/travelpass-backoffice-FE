import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyLogoutToken } from '@/lib/server/auth/keycloak'

// 백채널 로그아웃 (OIDC Back-Channel Logout). Keycloak이 서버끼리 직접 호출한다 — 브라우저는 안 거친다.
// Keycloak에서 세션 종료·계정 비활성화·비번 초기화(세션 로그아웃)·로그아웃이 일어나면
// logout_token(서명된 JWT)을 보내고, 여기서 검증한 뒤 해당 SSO 세션(sid) 또는 유저(sub)의 세션을 바로 지운다.
// → 다음 토큰 갱신(최대 access token 수명)까지 기다리지 않고 즉시 끊긴다.
// Keycloak 설정: poc-backoffice client의 Backchannel logout URL = <FE 주소>/api/auth/keycloak/backchannel-logout
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const logoutToken = form?.get('logout_token')
  if (typeof logoutToken !== 'string' || !logoutToken) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const claims = await verifyLogoutToken(logoutToken)
  if (!claims) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  // sid가 있으면 그 SSO 세션만, 없으면 그 유저의 모든 세션
  const where = claims.sid ? { kcSid: claims.sid } : { kcSub: claims.sub! }
  const { count } = await prisma.session.deleteMany({ where })
  console.info(`[keycloak] backchannel logout: ${claims.sid ? 'sid' : 'sub'} → 세션 ${count}개 삭제`)

  // 스펙상 성공은 200, 캐시 금지
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}

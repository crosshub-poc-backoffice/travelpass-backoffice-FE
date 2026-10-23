import { redirect } from 'next/navigation'
import { accountConsoleUrl } from '@/lib/server/auth/keycloak'
import { requireUser } from '@/lib/server/auth/session'

// 비밀번호는 Keycloak이 관리한다 → 로그인 확인 후 Keycloak 계정 콘솔(비밀번호 변경)로 보낸다.
export default async function ChangePasswordPage() {
  await requireUser()
  redirect(accountConsoleUrl())
}

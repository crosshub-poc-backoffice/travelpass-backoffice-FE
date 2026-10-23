import { redirect } from 'next/navigation'
import { accountConsoleUrl } from '@/lib/server/auth/keycloak'
import { requireUser } from '@/lib/server/auth/session'
import { ChangePasswordForm } from './form'

// 최초 로그인(임시 비밀번호)일 때는 여기로 강제로 오고, 평소에는 메뉴에서 들어온다.
// Keycloak으로 로그인한 사용자는 비밀번호를 Keycloak이 관리하므로 Keycloak 계정 콘솔로 보낸다.
export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true })
  if (user.authMethod === 'keycloak') redirect(accountConsoleUrl())
  return <ChangePasswordForm forced={user.mustChangePassword} />
}

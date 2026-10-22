import { requireUser } from '@/lib/server/auth/session'
import { ChangePasswordForm } from './form'

// 최초 로그인(임시 비밀번호)일 때는 여기로 강제로 오고, 평소에는 메뉴에서 들어온다.
export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true })
  return <ChangePasswordForm forced={user.mustChangePassword} />
}

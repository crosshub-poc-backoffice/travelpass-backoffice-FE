import { redirect } from 'next/navigation'
import { getSessionUser, localePath } from '@/lib/server/auth/session'
import { LoginForm } from './login-form'

// 로그인 화면(/{언어}). 이미 로그인돼 있으면 바로 대시보드(또는 비밀번호 변경)로 보낸다.
export default async function HomePage() {
  const user = await getSessionUser()
  if (user) redirect(await localePath(user.mustChangePassword ? '/change-password' : '/dashboard'))
  return <LoginForm />
}

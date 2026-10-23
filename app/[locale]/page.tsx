import { redirect } from 'next/navigation'
import { isErrorKey } from '@/lib/errors'
import { getSessionUser, localePath } from '@/lib/server/auth/session'
import { LoginForm } from './login-form'

type SearchParams = { error?: string }

// 로그인 화면(/{언어}). 이미 로그인돼 있으면 바로 대시보드(또는 비밀번호 변경)로 보낸다.
// error 쿼리는 Keycloak 콜백(app/api/auth/keycloak/callback)이 실패했을 때 붙여서 돌아온다 —
// 그쪽은 Server Action이 아니라 Route Handler라 useActionState로 못 넘기고 쿼리스트링으로 전달한다.
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSessionUser()
  if (user) redirect(await localePath(user.mustChangePassword ? '/change-password' : '/dashboard'))
  const { error } = await searchParams
  return <LoginForm initialError={isErrorKey(error) ? error : undefined} />
}

import type { ReactNode } from 'react'
import { Shell } from '@/components/shell'
import { SessionProvider } from '@/lib/role-context'
import { requireUser, toClientSession } from '@/lib/server/auth/session'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser()
  return (
    <SessionProvider session={toClientSession(user)}>
      <Shell>{children}</Shell>
    </SessionProvider>
  )
}

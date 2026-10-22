import type { ReactNode } from 'react'
import type { Menu } from '@/lib/permissions'
import { requireMenu } from '@/lib/server/auth/session'

export async function AdminGate({ menu, children }: { menu: Menu; children: ReactNode }) {
  await requireMenu(menu)
  return <>{children}</>
}

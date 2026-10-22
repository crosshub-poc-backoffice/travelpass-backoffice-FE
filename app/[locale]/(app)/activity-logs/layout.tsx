import type { ReactNode } from 'react'
import { AdminGate } from '@/components/admin-gate'

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminGate menu="activityLogs">{children}</AdminGate>
}

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Role } from './permissions'

export type { Role }

// 서버(lib/server/auth/session.ts의 toClientSession)가 넘겨주는 로그인 정보
export type ClientSession = {
  loginId: string
  name: string
  role: Role
  orgName: string | null
  managedPartners: { id: string; name: string }[]
  activePartnerId: string | null
}

const SessionContext = createContext<ClientSession | null>(null)

// 각 메뉴의 layout.tsx(AdminGate)가 로그인을 확인한 뒤 이 Provider로 감싼다
export function SessionProvider({ session, children }: { session: ClientSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useSession(): ClientSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession은 AdminGate(layout.tsx) 안에서만 쓸 수 있습니다.')
  return session
}

export function useRole() {
  return { role: useSession().role }
}

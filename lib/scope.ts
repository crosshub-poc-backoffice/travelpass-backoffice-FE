'use client'

import { useMemo, useTransition } from 'react'
import { switchPartner } from '@/app/actions/auth'
import { useSession } from './role-context'
import { PARTNERS, type Partner } from './mock-data'

export type ScopedPartner = {
  /** 현재 역할·선택 기준으로 "볼 수 있는" 업체명 목록. 상품/예약/문의/정산 등을 필터링할 때 이 배열로 거른다. */
  visiblePartnerNames: string[]
  /** 업체 전환으로 고른 업체명. 고르지 않았으면 null(관리 범위 전체 보기). 업체 계정은 자기 업체 */
  scopedPartnerName: string | null
  setScopedPartnerName: (name: string | null) => void
  /** 업체 전환을 서버에 저장하는 중이면 true */
  switching: boolean
  /** crosshub만 true — 모든 업체 정보를 수정할 수 있는 권한. */
  canEditAll: boolean
  /** 현재 역할이 다룰 수 있는 업체 목록 (업체는 자기 업체, 연맹은 대행 업체, 크로스허브는 전체). */
  managedPartners: Partner[]
}

// 로그인 정보(DB)의 업체 범위로 목업 데이터를 거르는 훅.
// 화면이 아직 목업이라 업체를 이름으로 맞춘다. 화면을 DB로 옮기면 서버에서 visiblePartnerIds로 거른다.
export function useScopedPartner(): ScopedPartner {
  const session = useSession()
  const [switching, startTransition] = useTransition()

  return useMemo(() => {
    const managedNames = session.managedPartners.map((p) => p.name)
    const pool = session.role === 'crosshub' ? PARTNERS : PARTNERS.filter((p) => managedNames.includes(p.name))
    const active = session.managedPartners.find((p) => p.id === session.activePartnerId) ?? null

    return {
      visiblePartnerNames: active ? [active.name] : pool.map((p) => p.name),
      scopedPartnerName: active?.name ?? null,
      setScopedPartnerName: (name: string | null) => {
        const id = name ? (session.managedPartners.find((p) => p.name === name)?.id ?? null) : null
        startTransition(() => switchPartner(id))
      },
      switching,
      canEditAll: session.role === 'crosshub',
      managedPartners: pool,
    }
  }, [session, switching])
}

/** items를 visiblePartnerNames에 속한 업체 것만 남기고 거른다. Product/Booking/Inquiry/SettlementRow 전부 partner 필드를 갖고 있어 공통으로 쓸 수 있다. */
export function filterByPartner<T extends { partner: string }>(items: T[], visiblePartnerNames: string[]): T[] {
  return items.filter((item) => visiblePartnerNames.includes(item.partner))
}

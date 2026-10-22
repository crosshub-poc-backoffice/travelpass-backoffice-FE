'use client'

import { useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'

// 로그인 화면은 메인("/")으로 통합됐습니다.
export default function LoginRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return null
}

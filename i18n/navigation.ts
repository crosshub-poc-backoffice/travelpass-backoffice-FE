import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

// 언어 접두사를 자동으로 붙여 주는 Link / 라우터. next/link, next/navigation 대신 이걸 쓴다.
// href에는 언어를 빼고 쓴다: <Link href="/products"> → /ko/products
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)

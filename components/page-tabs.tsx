'use client'

import { Link } from '@/i18n/navigation'

type Tab = { key: string; label: string; href: string | { pathname: string; query: Record<string, string> } }

// 화면 안의 탭. 탭마다 주소(?tab=)가 달라서 새로고침·뒤로가기해도 같은 탭이 열린다
export function PageTabs({ tabs, active }: { tabs: Tab[]; active: string }) {
  return (
    <nav className="page-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={tab.key === active ? 'active' : undefined}
          aria-current={tab.key === active ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

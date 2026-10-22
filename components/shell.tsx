'use client'

import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Globe,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  Menu,
  Package,
  Phone,
  Settings,
  Store,
  Landmark,
  TrendingUp,
  UserCog,
  WalletCards,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { logout, switchPartner } from '@/app/actions/auth'
import { useSession } from '@/lib/role-context'
import { canAccess, type Menu as MenuKey } from '@/lib/permissions'
import { LOCALE_LABELS, type Locale } from '@/i18n/routing'
import type { NotificationItem } from '@/lib/server/notifications/service'

type NavItem = {
  href: string
  labelKey: string
  /** 업체 계정에게 다르게 보일 이름 (업체 관리 → 내 업체 정보) */
  partnerLabelKey?: string
  icon: typeof LayoutDashboard
  menu: MenuKey
}

// 역할별로 보이는 메뉴는 lib/permissions.ts(메뉴권한표)가 정한다
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, menu: 'dashboard' },
  { href: '/products', labelKey: 'nav.products', icon: Package, menu: 'products' },
  { href: '/bookings', labelKey: 'nav.bookings', icon: CalendarDays, menu: 'bookings' },
  { href: '/inquiries', labelKey: 'nav.inquiries', icon: MessageCircle, menu: 'inquiries' },
  { href: '/settlements', labelKey: 'nav.settlements', icon: WalletCards, menu: 'settlements' },
  { href: '/stats', labelKey: 'nav.stats', icon: TrendingUp, menu: 'stats' },
  { href: '/partners', labelKey: 'nav.partners', partnerLabelKey: 'nav.myPartner', icon: Store, menu: 'partners' },
  { href: '/my-affiliate', labelKey: 'nav.myAffiliate', icon: Landmark, menu: 'myAffiliate' },
  { href: '/accounts', labelKey: 'nav.accounts', icon: UserCog, menu: 'accounts' },
  { href: '/activity-logs', labelKey: 'nav.activityLogs', icon: History, menu: 'activityLogs' },
]

const ROLE_KEY = { crosshub: 'role.crosshub', affiliate: 'role.affiliate', partner: 'role.partner' } as const

// 벨 배지·목록을 이 주기로 다시 물어본다. SSE 대신 폴링으로 — 서버리스 환경에서 커넥션을 오래 들고
// 있지 않으려는 선택이라 "즉시"는 아니고 "몇 초 지연"이다.
const NOTIF_POLL_MS = 15_000

function notifIcon(item: NotificationItem) {
  if (item.id.startsWith('booking-') || item.href.startsWith('/bookings')) return CalendarDays
  if (item.id.startsWith('inquiry-') || item.href.startsWith('/inquiries')) return MessageCircle
  if (item.id.startsWith('product-') || item.href.startsWith('/products')) return Package
  return Bell
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useSession()
  const { role } = session
  const t = useTranslations()
  const ts = useTranslations('shell')
  const locale = useLocale()
  const [switching, startSwitch] = useTransition()
  const [notifOpen, setNotifOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const langMenuRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // 드롭다운 바깥을 클릭하거나 Esc를 누르면 자동으로 닫히게 한다.
  useEffect(() => {
    if (!langMenuOpen && !notifOpen) return

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (langMenuOpen && langMenuRef.current && !langMenuRef.current.contains(target)) setLangMenuOpen(false)
      if (notifOpen && notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setLangMenuOpen(false)
        setNotifOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [langMenuOpen, notifOpen])

  function handleLocaleChange(next: Locale) {
    router.replace(pathname, { locale: next })
    setLangMenuOpen(false)
  }

  const items = NAV_ITEMS.filter((item) => canAccess(role, item.menu))
  const activeItem = NAV_ITEMS.find((item) => pathname.startsWith(item.href))
  const labelOf = (item: NavItem) => t(role === 'partner' && item.partnerLabelKey ? item.partnerLabelKey : item.labelKey)

  const initials = role === 'crosshub' ? 'CH' : role === 'affiliate' ? 'JF' : 'PT'

  const [unreadCount, setUnreadCount] = useState(0)
  const [notifItems, setNotifItems] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(false)

  function fetchList() {
    setNotifLoading(true)
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((d: { items: NotificationItem[] }) => setNotifItems(d.items))
      .catch(() => {})
      .finally(() => setNotifLoading(false))
  }

  function refreshUnreadCount() {
    fetch('/api/notifications/count')
      .then((r) => r.json())
      .then((d: { count: number }) => setUnreadCount(d.count))
      .catch(() => {})
  }

  useEffect(() => {
    if (notifOpen) fetchList()
  }, [notifOpen])

  const notifOpenRef = useRef(notifOpen)
  useEffect(() => {
    notifOpenRef.current = notifOpen
  }, [notifOpen])

  // 배지는 주기적으로, 목록은 드롭다운이 열려 있을 때만 같이 다시 물어본다.
  // 탭이 백그라운드면 쉬고, 다시 보일 때(visibilitychange) 바로 한 번 맞춘다.
  useEffect(() => {
    function poll() {
      if (document.visibilityState !== 'visible') return
      refreshUnreadCount()
      if (notifOpenRef.current) fetchList()
    }
    poll()
    const id = setInterval(poll, NOTIF_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [])

  // live-state는 Notification row가 없어서 "읽음" 대신 "이 사람한테서 숨김"을 DB(LiveNotificationDismissal)에
  // 남긴다 — 실제 Booking/Inquiry/Product/Partner 상태는 그대로라 다른 화면·다른 사용자에겐 계속 정확히 보인다.
  const [dismissedLiveIds, setDismissedLiveIds] = useState<Set<string>>(new Set())

  function handleNotificationClick(item: NotificationItem) {
    setNotifOpen(false)
    if (item.kind === 'live') {
      if (!dismissedLiveIds.has(item.id)) {
        setDismissedLiveIds((prev) => new Set(prev).add(item.id))
        setUnreadCount((c) => Math.max(0, c - 1))
        fetch('/api/notifications/live-dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: item.id }),
        }).catch(() => {})
      }
      return
    }
    if (item.read) return
    setNotifItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
    fetch(`/api/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {})
  }

  function handleMarkAllRead() {
    setNotifItems((prev) => prev.map((n) => (n.kind === 'event' ? { ...n, read: true } : n)))
    fetch('/api/notifications/read-all', { method: 'POST' })
      .then(refreshUnreadCount)
      .catch(() => {})
  }

  const hasUnreadEvent = notifItems.some((n) => n.kind === 'event' && !n.read)

  return (
    <div className="app-shell">
      <aside className="sidebar" style={mobileNavOpen ? { display: 'flex', position: 'fixed', zIndex: 30, height: '100vh' } : undefined}>
        <Link href="/dashboard" className="brand-lockup" style={{ textDecoration: 'none', color: 'inherit' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/travelpass-wordmark.svg" alt="Travel Pass" className="brand-wordmark" />
          <span>PARTNER CENTER</span>
        </Link>

        <div className="account-switcher" style={{ width: '100%' }}>
          <div className="avatar avatar-orange">{initials}</div>
          <div className="account-copy">
            <strong>{session.name}</strong>
            <span>{session.orgName ? `${t(ROLE_KEY[role])} · ${session.orgName}` : t(ROLE_KEY[role])}</span>
          </div>
        </div>

        {role !== 'partner' && (
          <div className="partner-scope">
            <p className="nav-label" style={{ margin: '14px 12px 8px' }}>
              {t(role === 'crosshub' ? 'scope.crosshub' : 'scope.affiliate')}
            </p>
            {/* 업체 전환: 고른 업체는 세션(DB)에 저장되고 화면이 새로 그려진다 */}
            <select
              className="partner-scope-select"
              value={session.activePartnerId ?? '__all__'}
              disabled={switching}
              onChange={(e) => {
                const next = e.target.value === '__all__' ? null : e.target.value
                startSwitch(() => switchPartner(next))
              }}
            >
              <option value="__all__">
                {t('scope.all')} ({session.managedPartners.length})
              </option>
              {session.managedPartners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="sidebar-nav" aria-label={ts('mainNavLabel')}>
          <p className="nav-label">{ts('menuSectionLabel')}</p>
          {items.map((item) => (
            <Link key={item.href} href={item.href} className={`nav-item ${pathname.startsWith(item.href) ? 'active' : ''}`} onClick={() => setMobileNavOpen(false)}>
              <item.icon size={18} strokeWidth={1.8} />
              <span>{labelOf(item)}</span>
            </Link>
          ))}
          <p className="nav-label nav-label-spaced">{ts('accountSectionLabel')}</p>
          <Link href="/settings" className={`nav-item ${pathname.startsWith('/settings') ? 'active' : ''}`} onClick={() => setMobileNavOpen(false)}>
            <Settings size={18} strokeWidth={1.8} />
            <span>{t('nav.settings')}</span>
          </Link>
          <form action={logout}>
            <button type="submit" className="nav-item" style={{ width: '100%' }}>
              <LogOut size={18} strokeWidth={1.8} />
              <span>{t('nav.logout')}</span>
            </button>
          </form>
        </nav>

        <div className="sidebar-bottom">
          <button className="help-card" style={{ border: 0, width: '100%', textAlign: 'left' }} onClick={() => setHelpOpen(true)}>
            <div className="help-icon">
              <CircleHelp size={17} />
            </div>
            <div>
              <strong>{ts('helpTitle')}</strong>
              <span>{ts('contactSupport')}</span>
            </div>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" aria-label={ts('openMenuAriaLabel')} onClick={() => setMobileNavOpen((v) => !v)}>
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="breadcrumbs">
            <span>{t('common.home')}</span>
            <ChevronRight size={14} />
            <strong>{activeItem ? labelOf(activeItem) : t('nav.settings')}</strong>
          </div>
          <div className="top-actions">
            <div ref={langMenuRef} style={{ position: 'relative' }}>
              <button className="icon-button" aria-label={ts('changeLanguageAriaLabel')} onClick={() => setLangMenuOpen((v) => !v)}>
                <Globe size={19} />
              </button>
              {langMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 10,
                    minWidth: 160,
                    background: '#fff',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 6,
                    zIndex: 40,
                    boxShadow: '0 12px 30px #00000014',
                  }}
                >
                  {(Object.keys(LOCALE_LABELS) as Locale[]).map((code) => (
                    <button
                      key={code}
                      className={`nav-item ${locale === code ? 'active' : ''}`}
                      onClick={() => handleLocaleChange(code)}
                    >
                      <span>{LOCALE_LABELS[code]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={notifRef} style={{ position: 'relative' }}>
              <button className="icon-button" aria-label={t('notifications.title')} onClick={() => setNotifOpen((v) => !v)}>
                <Bell size={19} />
                {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
              {notifOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 10,
                    width: 320,
                    background: '#fff',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 6,
                    zIndex: 40,
                    boxShadow: '0 12px 30px #00000014',
                    maxHeight: 360,
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 8px 8px' }}>
                    <p className="nav-label" style={{ margin: 0 }}>
                      {t('notifications.title')} {unreadCount > 0 ? `(${unreadCount})` : ''}
                    </p>
                    {hasUnreadEvent && (
                      <button
                        onClick={handleMarkAllRead}
                        style={{ fontSize: 10, color: '#9a7257', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                      >
                        {t('notifications.markAllRead')}
                      </button>
                    )}
                  </div>
                  {notifLoading ? (
                    <p className="muted" style={{ padding: '10px 8px', fontSize: 11 }}>
                      {t('notifications.loading')}
                    </p>
                  ) : notifItems.length === 0 ? (
                    <p className="muted" style={{ padding: '10px 8px', fontSize: 11 }}>
                      {t('notifications.empty')}
                    </p>
                  ) : (
                    notifItems.map((item) => {
                      const NotifIcon = notifIcon(item)
                      const isDimmed = (item.kind === 'event' && item.read) || (item.kind === 'live' && dismissedLiveIds.has(item.id))
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          className="nav-item"
                          onClick={() => handleNotificationClick(item)}
                          style={{ alignItems: 'flex-start', opacity: isDimmed ? 0.55 : 1 }}
                        >
                          <NotifIcon size={16} strokeWidth={1.8} style={{ marginTop: 1, flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>{item.text}</span>
                        </Link>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="content-wrap">{children}</div>
      </main>

      {helpOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setHelpOpen(false)}>
          <div className="modal-card" style={{ width: 'min(400px,100%)' }} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div>
                <p className="eyebrow">SUPPORT</p>
                <h2>{ts('contactSupport')}</h2>
              </div>
              <button className="close-button" onClick={() => setHelpOpen(false)} aria-label={t('common.close')}>
                <X size={19} />
              </button>
            </div>
            <div className="info-list" style={{ marginTop: 18 }}>
              <div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={14} /> {ts('phoneLabel')}
                </span>
                <strong>
                  <a href="tel:02-780-9930" style={{ color: 'inherit', textDecoration: 'none' }}>
                    02-780-9930
                  </a>
                </strong>
              </div>
              <div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={14} /> {ts('emailLabel')}
                </span>
                <strong>
                  <a href="mailto:travelpass@crosshub.kr" style={{ color: 'inherit', textDecoration: 'none' }}>
                    travelpass@crosshub.kr
                  </a>
                </strong>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              {ts('operatedBy', { company: '(주)크로스허브' })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

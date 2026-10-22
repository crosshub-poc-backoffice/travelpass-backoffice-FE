'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

// 목록 아래 페이지 번호. page는 1부터 시작.
// - pathname·query를 주면 page만 바꾼 주소로 이동하는 링크 (작업 이력·계정·업체 이력)
// - onChange를 주면 버튼으로 그 함수를 부른다 (예약·문의·상품 — 화면이 직접 주소를 바꾼다)
type Props = { page: number; total: number; pageSize: number } & (
  | { pathname: string; query: Record<string, string>; onChange?: never }
  | { onChange: (page: number) => void; pathname?: never; query?: never }
)

export function Pagination(props: Props) {
  const { page, total, pageSize } = props
  const t = useTranslations('common')
  const last = Math.max(1, Math.ceil(total / pageSize))
  if (last === 1) return null

  // 지금 페이지 앞뒤로 2개씩, 최대 5개 번호만 보여준다
  const start = Math.max(1, Math.min(page - 2, last - 4))
  const pages = Array.from({ length: Math.min(5, last) }, (_, i) => start + i)

  function item(p: number, children: React.ReactNode, label?: string) {
    if (props.onChange) {
      const onChange = props.onChange
      return (
        <button type="button" key={`${label ?? ''}${p}`} aria-label={label} onClick={() => onChange(p)}>
          {children}
        </button>
      )
    }
    return (
      <Link key={`${label ?? ''}${p}`} href={{ pathname: props.pathname, query: { ...props.query, page: String(p) } }} aria-label={label}>
        {children}
      </Link>
    )
  }

  return (
    <nav className="pagination" aria-label={t('pagination')}>
      {page > 1 ? (
        item(page - 1, <ChevronLeft size={14} />, t('prevPage'))
      ) : (
        <span aria-hidden>
          <ChevronLeft size={14} />
        </span>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} className="current" aria-current="page">
            {p}
          </span>
        ) : (
          item(p, p)
        ),
      )}
      {page < last ? (
        item(page + 1, <ChevronRight size={14} />, t('nextPage'))
      ) : (
        <span aria-hidden>
          <ChevronRight size={14} />
        </span>
      )}
    </nav>
  )
}

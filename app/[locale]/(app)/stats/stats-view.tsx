'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { Pagination } from '@/components/pagination'
import { formatMoney } from '@/lib/money'
import { shiftMonth } from '@/lib/settlements'
import type { StatsData, StatsFilter } from '@/lib/server/stats/service'
import { DateField } from '@/components/date-fields'

const shiftDay = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
const rangeLabel = (r: StatsFilter) => `${r.from.replaceAll('-', '.')} ~ ${r.to.replaceAll('-', '.')}`

/** 직전 기간 대비 증감률. 직전이 0이면 비교하지 않는다 */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return null
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100)
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  return (
    <em className={`stat-delta ${dir}`}>
      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'} {Math.abs(pct)}%
    </em>
  )
}

type SortDir = 'asc' | 'desc'
// 업체·상품 표는 한 페이지에 이만큼씩
const TABLE_PAGE_SIZE = 10

function useSort<T>(rows: T[], initial: keyof T) {
  const [key, setKey] = useState<keyof T>(initial)
  const [dir, setDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const sorted = [...rows].sort((a, b) => {
    const x = a[key]
    const y = b[key]
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')
    return dir === 'asc' ? c : -c
  })
  function header(k: keyof T, label: string, numeric = true) {
    const active = key === k
    return (
      <th className={numeric ? 'num' : undefined} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className={`sort-button${active ? ' active' : ''}`}
          onClick={() => {
            setPage(1)
            if (active) setDir(dir === 'asc' ? 'desc' : 'asc')
            else {
              setKey(k)
              setDir(numeric ? 'desc' : 'asc')
            }
          }}
        >
          {label}
          <span aria-hidden>{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
      </th>
    )
  }
  // 기간을 바꿔 행 수가 줄면 마지막 페이지로
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE)))
  const pageRows = sorted.slice((current - 1) * TABLE_PAGE_SIZE, current * TABLE_PAGE_SIZE)
  const pager = <Pagination page={current} pageSize={TABLE_PAGE_SIZE} total={rows.length} onChange={setPage} />
  return { pageRows, header, pager }
}

/** 0건은 흐리게 */
const Count = ({ n }: { n: number }) => <td className={`num${n ? '' : ' muted'}`}>{n}</td>

export function StatsView({
  data,
  filter,
  today,
  multiPartner,
}: {
  data: StatsData
  filter: StatsFilter
  today: string
  multiPartner: boolean
}) {
  const t = useTranslations()
  const ts = useTranslations('stats')
  const locale = useLocale()
  const router = useRouter()
  const multiCurrency = data.sales.length > 1 || data.settlement.rows.length > 1

  const thisMonth = today.slice(0, 7)
  const presets = [
    { label: ts('presetThisMonth'), from: `${thisMonth}-01`, to: today },
    { label: ts('presetLastMonth'), from: `${shiftMonth(thisMonth, -1)}-01`, to: shiftDay(`${thisMonth}-01`, -1) },
    { label: ts('preset3m'), from: `${shiftMonth(thisMonth, -2)}-01`, to: today },
    { label: ts('preset6m'), from: `${shiftMonth(thisMonth, -5)}-01`, to: today },
  ]

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    router.push({ pathname: '/stats', query: { from: String(form.get('from') ?? ''), to: String(form.get('to') ?? '') } })
  }

  // 추이 그래프: 통화별 판매금액 (통화가 여럿일 때만 통화 전환 버튼)
  const currencies = data.sales.map((m) => m.currency)
  const [metric, setMetric] = useState<string>('')
  const chartCurrency = currencies.includes(metric) ? metric : (currencies[0] ?? 'JPY')
  const values = data.series.map((s) => s.amount[chartCurrency] ?? 0)
  const max = Math.max(1, ...values)
  const empty = values.every((v) => !v)
  // 칸 라벨: 일별 "10/7", 월별은 언어에 맞춘 달 이름, 연도를 넘으면 "25.01"
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
  const multiYear = filter.from.slice(0, 4) !== filter.to.slice(0, 4)
  const labelOf = (key: string) =>
    data.bucket === 'day'
      ? `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`
      : multiYear
        ? `${key.slice(2, 4)}.${key.slice(5)}`
        : monthName.format(new Date(`${key}-01T00:00:00Z`))
  const labelStep = Math.ceil(data.series.length / 12)
  const showValues = data.series.length <= 14
  const formatValue = (v: number) => formatMoney(v, chartCurrency)

  const partnerTable = useSort(data.partners, 'amount')
  const productTable = useSort(data.products, 'sold')

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">SALES STATISTICS</p>
          <h1>{t('page.stats.title')}</h1>
        </div>
      </section>

      <form key={`${filter.from}-${filter.to}`} className="filter-bar" style={{ marginTop: 0 }} onSubmit={handleSearch}>
        <nav className="stats-presets" aria-label={ts('period')}>
          {presets.map((p) => (
            <Link
              key={p.label}
              href={{ pathname: '/stats', query: { from: p.from, to: p.to } }}
              className={p.from === filter.from && p.to === filter.to ? 'active' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <DateField name="from" defaultValue={filter.from} max={today} ariaLabel={t('audit.from')} />
        <span className="muted">~</span>
        <DateField name="to" defaultValue={filter.to} max={today} ariaLabel={t('audit.to')} />
        <button type="submit" className="primary-button">
          {t('common.search')}
        </button>
        <p className="stats-range">
          <span>
            {ts('rangeBase')} <b>{rangeLabel(filter)}</b>
          </span>
          <span>
            {ts('vsPrev')} {rangeLabel(data.prev)}
          </span>
        </p>
      </form>

      {/* 카드 한 줄: 판매금액(통화별) · 판매 건수 · 수익(통화별). 환산 없음. 판매 = 확정·이용완료 */}
      <section className="stat-kpis">
        {data.sales.map((m) => (
          <div key={`sales-${m.currency}`} className="stat-eq-card">
            <span>{multiCurrency ? `${ts('sales')} ${m.currency}` : ts('sales')}</span>
            <strong>{formatMoney(m.amount, m.currency)}</strong>
            <Delta cur={m.amount} prev={m.prevAmount} />
          </div>
        ))}
        <div className="stat-eq-card">
          <span>{ts('soldCount')}</span>
          <strong>{ts('countUnit', { count: data.soldTotal })}</strong>
          <Delta cur={data.soldTotal} prev={data.prevSoldTotal} />
          {data.canceledTotal > 0 && <small className="stat-note">{ts('canceledNote', { count: data.canceledTotal })}</small>}
        </div>
        {data.settlement.rows.map((s) => (
          <div key={`settle-${s.currency}`} className="stat-eq-card total">
            <span>{multiCurrency ? `${ts('settlementTitle')} ${s.currency}` : ts('settlementTitle')}</span>
            <strong>{formatMoney(s.amount, s.currency)}</strong>
            <Delta cur={s.amount} prev={s.prevAmount} />
          </div>
        ))}
      </section>

      <div className="card stats-chart-card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <h2>{ts('trend')}</h2>
          {currencies.length > 1 && (
            <div className="stats-segment" role="tablist">
              {currencies.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={chartCurrency === k} className={chartCurrency === k ? 'active' : undefined} onClick={() => setMetric(k)}>
                  {k}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="stats-chart" data-dense={showValues ? undefined : ''}>
          <div className="stats-chart-grid" aria-hidden>
            <span>{empty ? '' : formatValue(max)}</span>
            <span />
            <span />
          </div>
          <div className="stats-chart-bars">
            {data.series.map((s, i) => (
              <div className="stats-bar" key={s.key} data-edge={i < 2 ? 'start' : i >= data.series.length - 2 ? 'end' : undefined}>
                {showValues && <b>{values[i] ? formatValue(values[i]) : ''}</b>}
                <i style={{ height: `${(Math.max(0, values[i]) / max) * 100}%` }} data-zero={values[i] ? undefined : ''} />
                <span>{i % labelStep === 0 ? labelOf(s.key) : ''}</span>
                {/* 마우스를 올리면: 금액 · 판매 건수 · 많이 팔린 상품 3개 */}
                <div className="stats-tip" role="tooltip">
                  <p>
                    {labelOf(s.key)} · <b>{formatValue(values[i])}</b>
                  </p>
                  <p>{ts('tipSold', { count: s.sold[chartCurrency] ?? 0 })}</p>
                  {(s.top[chartCurrency] ?? []).length > 0 && (
                    <ol>
                      {s.top[chartCurrency].map((p, rank) => (
                        <li key={p.name}>
                          <strong>{rank + 1}</strong>
                          <span>
                            <AiText ai={p.nameAi}>{p.name}</AiText>
                          </span>
                          <em>{ts('countUnit', { count: p.count })}</em>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 업체가 2곳 이상 보일 때만(연맹/크로스허브가 전체 보기 중) 업체별 표를 보여준다 */}
      {multiPartner && (
        <div className="card products-card stats-table-card">
          <div className="card-header">
            <h2>{ts('partnersTitle')}</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {partnerTable.header('name', ts('colPartner'), false)}
                  {partnerTable.header('sold', ts('colSold'))}
                  {partnerTable.header('canceled', ts('colCanceled'))}
                  {partnerTable.header('amount', ts('colAmount'))}
                  {partnerTable.header('settlementNet', ts('colSettlement'))}
                </tr>
              </thead>
              <tbody>
                {partnerTable.pageRows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={{ pathname: '/bookings', query: { partnerId: p.id } }} className="stats-link">
                        {p.name}
                      </Link>
                    </td>
                    <Count n={p.sold} />
                    <Count n={p.canceled} />
                    <td className="num strong">{formatMoney(p.amount, p.currency)}</td>
                    <td className="num">{formatMoney(p.settlementNet, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {partnerTable.pager}
        </div>
      )}

      <div className="card products-card stats-table-card">
        <div className="card-header">
          <h2>{ts('productsTitle')}</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {productTable.header('name', ts('colProduct'), false)}
                {multiPartner && productTable.header('partner', ts('colPartner'), false)}
                {productTable.header('sold', ts('colSold'))}
                {productTable.header('canceled', ts('colCanceled'))}
                {productTable.header('amount', ts('colAmount'))}
              </tr>
            </thead>
            <tbody>
              {productTable.pageRows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={{ pathname: '/bookings', query: { productId: p.id } }} className="stats-link">
                      <AiText ai={p.nameAi}>{p.name}</AiText>
                    </Link>
                  </td>
                  {multiPartner && <td className="muted">{p.partner}</td>}
                  <Count n={p.sold} />
                  <Count n={p.canceled} />
                  <td className="num strong">{formatMoney(p.amount, p.currency)}</td>
                </tr>
              ))}
              {data.products.length === 0 && (
                <tr>
                  <td colSpan={multiPartner ? 5 : 4} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                    {ts('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {productTable.pager}
      </div>
    </>
  )
}

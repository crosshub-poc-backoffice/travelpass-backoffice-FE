'use client'

import { Fragment, useState, useTransition } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { AiText } from '@/components/ai-tag'
import { Link, useRouter } from '@/i18n/navigation'
import { PageTabs } from '@/components/page-tabs'
import type { ErrorKey } from '@/lib/errors'
import { rateLabel } from '@/lib/fees'
import { formatMoney } from '@/lib/money'
import type { Role } from '@/lib/permissions'
import { SETTLEMENT_TABS, isMonthEnded, jstToday, shiftMonth, type SettlementTab } from '@/lib/settlements'
import type { AffiliateSettlementRow, SettlementRow } from '@/lib/server/settlements/service'
import {
  markAffiliateSettlementPaidAction,
  markSettlementPaidAction,
  unmarkAffiliateSettlementPaidAction,
  unmarkSettlementPaidAction,
  type ActionResult,
} from './actions'
import { DateField, MonthField } from '@/components/date-fields'
import { formatMonth } from '@/lib/datetime'

type Schedule = { currency: string; payDay: number }

export function SettlementsView({
  tab,
  month,
  rows,
  affiliateRows,
  schedules,
  role,
  children,
}: {
  tab: SettlementTab
  month: string
  rows: SettlementRow[]
  /** 연맹 몫. 크로스허브는 연맹 전체, 연맹은 자기 것, 업체는 빈 배열 */
  affiliateRows: AffiliateSettlementRow[]
  /** 통화별 정산 기준·지급일 (월 선택기 옆 꼬리표) */
  schedules: Schedule[]
  /** 크로스허브만 지급완료 처리 + 결제 설정 탭. 연맹은 자기 몫 카드, 업체는 자기 정산만 */
  role: Role
  /** 정산 탭 말고 다른 탭이면 그 탭 내용. 제목·탭은 같이 쓴다 */
  children?: React.ReactNode
}) {
  const t = useTranslations()
  const canManage = role === 'crosshub'
  const tabs = SETTLEMENT_TABS.filter((key) => key !== 'settings' || canManage)

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">SETTLEMENTS</p>
          <h1>{t('page.settlements.title')}</h1>
        </div>
      </section>

      <PageTabs
        active={tab}
        tabs={tabs.map((key) => ({
          key,
          label: t(`settlements.tab.${key}`),
          href: key === 'monthly' ? '/settlements' : { pathname: '/settlements', query: { tab: key } },
        }))}
      />

      {children ?? <MonthlySettlements month={month} rows={rows} affiliateRows={affiliateRows} schedules={schedules} role={role} />}
    </>
  )
}

/** 지급완료 모달이 다루는 대상. 업체 행과 연맹 행이 같은 모달을 쓴다 */
// 송금 상태는 화면에서 4개로 나눠 보여준다 (DB는 대기·완료 두 개). 안 끝난 달은 금액이 계속 바뀌니 '집계중',
// 끝난 달에 줄 돈이 없으면 '송금 없음'. 이미 완료 처리한 건은 달과 상관없이 '송금완료'
type PayoutState = 'calculating' | 'pending' | 'paid' | 'noPayout'
const PAYOUT_TONE: Record<PayoutState, string> = {
  calculating: 'status-draft',
  pending: 'status-review',
  paid: 'status-live',
  noPayout: 'status-hidden',
}
function payoutState(status: 'pending' | 'paid', hasPayout: boolean, monthEnded: boolean): PayoutState {
  if (status === 'paid') return 'paid'
  if (!monthEnded) return 'calculating'
  return hasPayout ? 'pending' : 'noPayout'
}

type PayTarget = { name: string; amount: number; currency: string; bankAccount?: string | null; submit: (payDate: string) => Promise<ActionResult> }

// 월별·업체별 1행. 펼치면 그 달 건별 내역 + (크로스허브) 수수료 배분. 크로스허브는 아래에 연맹 지급 목록까지
function MonthlySettlements({
  month,
  rows,
  affiliateRows,
  schedules,
  role,
}: {
  month: string
  rows: SettlementRow[]
  affiliateRows: AffiliateSettlementRow[]
  schedules: Schedule[]
  role: Role
}) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const canManage = role === 'crosshub'
  // 끝난 달만 지급완료할 수 있다 (서버도 막는다)
  const monthEnded = isMonthEnded(month)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null)
  const [error, setError] = useState<ErrorKey | null>(null)
  const [pending, startTransition] = useTransition()

  // 통화가 섞이면 환산하지 않고 통화마다 따로 식을 보여준다
  const currencies = [...new Set(rows.map((r) => r.currency))]

  // 달력에서 월을 고르면 바로 그 달로 이동 (화살표는 링크라 원래 바로 이동)
  function goToMonth(next: string) {
    if (next && next !== month) router.push({ pathname: '/settlements', query: { month: next } })
  }

  function unmark(name: string, action: () => Promise<ActionResult>) {
    if (!window.confirm(`${name} · ${formatMonth(month, locale)}\n${t('settlements.unmarkConfirm')}`)) return
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setError(result.error)
    })
  }
  const payPartner = (r: SettlementRow): PayTarget => ({
    name: r.partnerName,
    amount: r.net,
    currency: r.currency,
    bankAccount: r.bankAccount,
    submit: (d) => markSettlementPaidAction(r.partnerId, month, d),
  })
  const payAffiliate = (a: AffiliateSettlementRow): PayTarget => ({
    name: a.affiliateName,
    amount: a.amount,
    currency: a.currency,
    bankAccount: a.bankAccount,
    submit: (d) => markAffiliateSettlementPaidAction(a.affiliateId, month, a.currency, d),
  })

  const colCount = canManage ? 11 : 10

  return (
    <div className="card products-card">
      <div className="filter-bar">
        <Link href={{ pathname: '/settlements', query: { month: shiftMonth(month, -1) } }} className="outline-button" aria-label={t('settlements.prevMonth')}>
          <ChevronLeft size={14} />
        </Link>
        <MonthField value={month} onChange={goToMonth} ariaLabel={t('settlements.month')} />
        <Link href={{ pathname: '/settlements', query: { month: shiftMonth(month, 1) } }} className="outline-button" aria-label={t('settlements.nextMonth')}>
          <ChevronRight size={14} />
        </Link>
        {/* 규칙은 안내문 대신 기간 표시에 붙인다: 어느 달 이용분을 언제 주는지 */}
        {scheduleTags(month, schedules, [...new Set(rows.map((r) => r.currency))], locale, t).map((tag) => (
          <span key={tag} className="muted" style={{ fontSize: 12 }}>
            {tag}
          </span>
        ))}
        <span className="total">{t('common.totalCount', { count: rows.length })}</span>
      </div>

      {error && <p style={{ color: '#c45b4d', fontSize: 12 }}>{t(`errors.${error}`)}</p>}

      {/* 판매가 = 업체 지급 + 수수료, 수수료 칸 안에 배분. 업체는 수수료까지, 연맹은 자기 몫까지, 크로스허브는 PG·연맹·크로스허브 전부 */}
      {currencies.map((currency) => {
        const rs = rows.filter((r) => r.currency === currency)
        if (role === 'crosshub') return <CrosshubEquation key={currency} currency={currency} rows={rs} />
        const myShare = role === 'affiliate' ? affiliateRows.find((a) => a.currency === currency) : undefined
        const parts: EqPart[] | undefined = myShare && [
          {
            label: `${t('settlements.myShare')} ${myShare.shareRateLabel}%`,
            value: myShare.amount,
            accent: true,
            note: `${t(`settlements.${myShare.status}`)}${myShare.payDate ? ` · ${myShare.payDate}` : ''}`,
          },
        ]
        return <FeeEquation key={currency} currency={currency} rows={rs} netLabel={role === 'affiliate' ? t('settlements.eqPartnerPay') : t('settlements.eqNet')} parts={parts} />
      })}

      <div className="table-wrap">
        <table>
          <thead style={{ whiteSpace: 'nowrap' }}>
            <tr>
              <th>
                <span className="sr-only">{t('settlements.detail')}</span>
              </th>
              <th>{t('settlements.colPartner')}</th>
              <th>{t('settlements.colCurrency')}</th>
              <th>{t('settlements.colGross')}</th>
              <th>{t('settlements.colRate')}</th>
              <th>{t('settlements.colCommission')}</th>
              <th>{t('settlements.colNet')}</th>
              <th>{t('settlements.colCount')}</th>
              <th>{t('settlements.colStatus')}</th>
              <th>{t('settlements.colPayDate')}</th>
              {canManage && (
                <th>
                  <span className="sr-only">{t('settlements.markPaid')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount}>{t('settlements.empty')}</td>
              </tr>
            )}
            {rows.map((r) => {
              const open = expanded === r.partnerId
              const toggle = () => setExpanded(open ? null : r.partnerId)
              const state = payoutState(r.status, r.bookingCount > 0, monthEnded)
              return (
                <Fragment key={r.partnerId}>
                  <tr>
                    <td>
                      <button className="table-link" onClick={toggle} aria-expanded={open} aria-label={t('settlements.detail')}>
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                    <td>
                      <button className="table-link" onClick={toggle}>
                        <strong>{r.partnerName}</strong>
                      </button>
                    </td>
                    <td>{r.currency}</td>
                    <td>{formatMoney(r.gross, r.currency)}</td>
                    <td>{r.commissionRateLabel === '-' ? '-' : `${r.commissionRateLabel}%`}</td>
                    <td>{formatMoney(r.commission, r.currency)}</td>
                    <td>
                      <strong>{formatMoney(r.net, r.currency)}</strong>
                    </td>
                    <td>{r.bookingCount}</td>
                    <td>
                      <span className={`status ${PAYOUT_TONE[state]}`}>
                        <i />
                        {t(`settlements.${state}`)}
                      </span>
                    </td>
                    <td className="muted">{r.payDate ?? '-'}</td>
                    {canManage && (
                      <td>
                        {state === 'paid' && (
                          <button className="outline-button" disabled={pending} onClick={() => unmark(r.partnerName, () => unmarkSettlementPaidAction(r.partnerId, month))}>
                            {t('settlements.unmarkPaid')}
                          </button>
                        )}
                        {state === 'pending' && (
                          <button className="primary-button" style={{ whiteSpace: 'nowrap' }} disabled={pending} onClick={() => setPayTarget(payPartner(r))}>
                            {t('settlements.markPaid')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={colCount} style={{ padding: '0 0 14px' }}>
                        <SettlementDetail row={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 연맹 지급 목록 (크로스허브). 업체 지급과 따로 월 1회 */}
      {canManage && (
        <>
          <div className="card-header" style={{ marginTop: 26 }}>
            <div>
              <h2>{t('settlements.affiliateTitle')}</h2>
              <p>{t('settlements.affiliateHint')}</p>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead style={{ whiteSpace: 'nowrap' }}>
                <tr>
                  <th>{t('settlements.colAffiliate')}</th>
                  <th>{t('settlements.bankAccount')}</th>
                  <th>{t('settlements.colCurrency')}</th>
                  <th>{t('settlements.colPartnerCount')}</th>
                  <th>{t('settlements.colShareRate')}</th>
                  <th>{t('settlements.colShareAmount')}</th>
                  <th>{t('settlements.colStatus')}</th>
                  <th>{t('settlements.colPayDate')}</th>
                  <th>
                    <span className="sr-only">{t('settlements.markPaid')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {affiliateRows.length === 0 && (
                  <tr>
                    <td colSpan={9}>{t('settlements.affiliateEmpty')}</td>
                  </tr>
                )}
                {affiliateRows.map((a) => {
                  const state = payoutState(a.status, a.amount > 0, monthEnded)
                  return (
                  <tr key={`${a.affiliateId}-${a.currency}`}>
                    <td>
                      <strong>{a.affiliateName}</strong>
                    </td>
                    <td className={a.bankAccount ? undefined : 'muted'}>{a.bankAccount ?? t('settlements.noBankAccount')}</td>
                    <td>{a.currency}</td>
                    <td>{a.partnerCount}</td>
                    <td>{a.shareRateLabel}%p</td>
                    <td>
                      <strong>{formatMoney(a.amount, a.currency)}</strong>
                    </td>
                    <td>
                      <span className={`status ${PAYOUT_TONE[state]}`}>
                        <i />
                        {t(`settlements.${state}`)}
                      </span>
                    </td>
                    <td className="muted">{a.payDate ?? '-'}</td>
                    <td>
                      {state === 'paid' && (
                        <button className="outline-button" disabled={pending} onClick={() => unmark(a.affiliateName, () => unmarkAffiliateSettlementPaidAction(a.affiliateId, month, a.currency))}>
                          {t('settlements.unmarkPaid')}
                        </button>
                      )}
                      {state === 'pending' && (
                        <button className="primary-button" style={{ whiteSpace: 'nowrap' }} disabled={pending} onClick={() => setPayTarget(payAffiliate(a))}>
                          {t('settlements.markPaid')}
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {payTarget && <PayModal target={payTarget} month={month} onClose={() => setPayTarget(null)} />}
    </div>
  )
}

/** "9월 이용분 · 10/15 지급" 꼬리표. 화면에 보이는 통화마다 하나 (설정 없는 통화는 이용완료일·15일로) */
function scheduleTags(month: string, schedules: Schedule[], currencies: string[], locale: string, t: ReturnType<typeof useTranslations>): string[] {
  // 달 이름은 언어에 맞춰 (9월 · 9月 · September)
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
  const next = shiftMonth(month, 1)
  const list = currencies.length ? currencies : schedules.map((s) => s.currency)
  return [...new Set(list)].map((currency) => {
    const s = schedules.find((x) => x.currency === currency)
    const prefix = list.length > 1 ? `${currency} ` : ''
    return `${prefix}${t('settlements.scheduleTag', { month: monthName, payDate: `${Number(next.slice(5))}/${s?.payDay ?? 15}` })}`
  })
}

/** 수수료 칸 안에 들어가는 배분 한 칸 */
type EqPart = { label: string; value: number; accent?: boolean; note?: string }

/** 요율은 그 묶음의 건이 모두 같을 때만 붙인다. 섞이면 숫자만 (합계로 나눈 요율은 오해를 부른다) */
const pct = (rates: number[], unit = '%') => {
  const label = rateLabel(rates)
  return label && !label.includes('~') ? ` ${label}${unit}` : ''
}

// 판매가 = 업체 지급 + 수수료 [배분]. 규칙을 문장 대신 식의 모양으로 보여준다
function FeeEquation({ currency, rows, netLabel, parts, caption, action }: { currency: string; rows: SettlementRow[]; netLabel: string; parts?: EqPart[]; caption?: string; action?: React.ReactNode }) {
  const t = useTranslations()
  const fm = (n: number) => formatMoney(n, currency)
  const lines = rows.flatMap((r) => r.lines)
  const sum = (key: 'gross' | 'net' | 'commission') => rows.reduce((s, r) => s + r[key], 0)

  return (
    <section className="fee-eq-block" aria-label={caption ?? currency}>
      {caption && <p className="fee-eq-caption">{caption}</p>}
      <div className="fee-eq">
        <div className="fee-eq-card">
          <span>
            {t('settlements.eqGross')} ({currency})
          </span>
          <strong>{fm(sum('gross'))}</strong>
        </div>
        <i>=</i>
        <div className="fee-eq-card">
          <span>
            {netLabel}
            {pct(lines.map((l) => 100 - l.commissionRate))}
          </span>
          <strong className="orange-text">{fm(sum('net'))}</strong>
        </div>
        <i>+</i>
        <div className="fee-eq-card fee-eq-commission">
          <span>
            {t('settlements.eqCommission')}
            {pct(lines.map((l) => l.commissionRate))}
            {action}
          </span>
          <strong>{fm(sum('commission'))}</strong>
          {parts && (
            <div className="fee-eq-parts" style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}>
              {parts.map((p) => (
                <div key={p.label}>
                  <span>{p.label}</span>
                  <b className={p.accent ? 'orange-text' : undefined}>{fm(p.value)}</b>
                  {p.note && <small>{p.note}</small>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// 크로스허브: 평소엔 합계 식 하나, 누르면 연맹 대행 업체 / 직접 업체 두 식으로 나눈다 (나누면 크로스허브 몫 요율이 하나로 떨어진다)
function CrosshubEquation({ currency, rows }: { currency: string; rows: SettlementRow[] }) {
  const t = useTranslations()
  const [split, setSplit] = useState(false)
  const proxy = rows.filter((r) => r.distribution?.affiliateName)
  const direct = rows.filter((r) => !r.distribution?.affiliateName)
  const canSplit = proxy.length > 0 && direct.length > 0

  // 직접 업체 묶음엔 연맹 칸 자체가 없다
  const partsOf = (rs: SettlementRow[], withAffiliate = true): EqPart[] => {
    const lines = rs.flatMap((r) => r.lines)
    const total = (key: 'pg' | 'affiliate' | 'crosshub') => rs.reduce((s, r) => s + (r.distribution?.[key] ?? 0), 0)
    const pg = { label: t('settlements.eqPg') + pct(lines.map((l) => l.pgFeeRate)), value: total('pg') }
    const affiliate = { label: t('settlements.eqAffiliate') + pct(lines.map((l) => l.affiliateShareRate)), value: total('affiliate'), accent: true }
    const crosshub = { label: t('settlements.eqCrosshub') + pct(lines.map((l) => l.commissionRate - l.pgFeeRate - l.affiliateShareRate)), value: total('crosshub') }
    return withAffiliate ? [pg, affiliate, crosshub] : [pg, crosshub]
  }
  const toggle = canSplit && (
    <button type="button" className="fee-eq-toggle" onClick={() => setSplit(!split)} aria-expanded={split}>
      {split ? t('settlements.eqMerge') : t('settlements.eqSplit')}
      {split ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
    </button>
  )
  const label = t('settlements.eqPartnerPay')

  return (
    <>
      <FeeEquation currency={currency} rows={rows} netLabel={label} parts={partsOf(rows)} action={toggle} />
      {split && (
        <div className="fee-eq-split">
          <FeeEquation currency={currency} rows={proxy} netLabel={label} parts={partsOf(proxy)} caption={t('settlements.eqProxy', { count: proxy.length })} />
          <FeeEquation currency={currency} rows={direct} netLabel={label} parts={partsOf(direct, false)} caption={t('settlements.eqDirect', { count: direct.length })} />
        </div>
      )}
    </>
  )
}

function SettlementDetail({ row }: { row: SettlementRow }) {
  const t = useTranslations()
  const fm = (n: number) => formatMoney(n, row.currency)
  const d = row.distribution

  return (
    <div style={{ padding: '10px 14px', background: '#faf9f7', borderRadius: 9 }}>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
        {t('settlements.basis.completed')}
        {row.distribution && <> · {t('settlements.bankAccount')}: {row.bankAccount ?? t('settlements.noBankAccount')}</>}
      </p>
      {row.lines.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {t('settlements.noLines')}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('settlements.lineBooking')}</th>
              <th>{t('settlements.lineProduct')}</th>
              <th>{t('settlements.lineUseDate')}</th>
              <th>{t('settlements.lineStatus')}</th>
              <th>{t('settlements.lineBase')}</th>
              <th>{t('settlements.colCommission')}</th>
              <th>{t('settlements.colNet')}</th>
            </tr>
          </thead>
          <tbody>
            {row.lines.map((l) => (
              <tr key={l.bookingId}>
                <td>{l.bookingId}</td>
                <td>
                  <AiText ai={l.productNameAi}>{l.productName}</AiText>
                </td>
                <td className="muted">{l.useDate}</td>
                <td>
                  {t(`bookings.status.${l.status}`)}
                  {l.isCancel && <span className="muted"> · {t('settlements.cancelFeeNote')}</span>}
                </td>
                <td>{fm(l.base)}</td>
                <td>{fm(l.commission)}</td>
                <td>
                  <strong>{fm(l.net)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 수수료 배분: 크로스허브만. 업체는 자기 수수료율 하나만 본다 */}
      {d && (
        <p style={{ fontSize: 12, margin: '10px 0 0' }}>
          <strong>{t('settlements.distribution')}</strong> {fm(row.commission)} ={' '}
          {d.pgName ? t('settlements.distPg', { name: d.pgName, rate: d.pgFeeRateLabel }) : t('settlements.distNoPg')} {fm(d.pg)}
          {d.affiliateName && (
            <>
              {' + '}
              {t('settlements.distAffiliate', { name: d.affiliateName, rate: d.affiliateShareRateLabel })} {fm(d.affiliate)}
            </>
          )}
          {' + '}
          {t('settlements.distCrosshub')} {fm(d.crosshub)}
        </p>
      )}
    </div>
  )
}

// 지급완료 처리: 지급일을 받고 지금 계산된 금액을 굳힌다 (업체·연맹 공용)
function PayModal({ target, month, onClose }: { target: PayTarget; month: string; onClose: () => void }) {
  const t = useTranslations()
  const locale = useLocale()
  const [payDate, setPayDate] = useState(jstToday())
  const [error, setError] = useState<ErrorKey | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await target.submit(payDate)
      if (result.error) setError(result.error)
      else onClose()
    })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
        <div className="modal-top">
          <div>
            <p className="eyebrow">SETTLEMENT</p>
            <h2>{target.name}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label={t('common.close')}>
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="info-list">
            <div>
              <span>{t('settlements.month')}</span>
              <strong>{formatMonth(month, locale)}</strong>
            </div>
            <div>
              <span>{t('settlements.payAmount')}</span>
              <strong className="orange-text">{formatMoney(target.amount, target.currency)}</strong>
            </div>
            {/* 업체 지급이면 송금할 계좌를 같이 보여준다 (연맹은 계좌 칸이 없어 생략) */}
            {target.bankAccount !== undefined && (
              <div>
                <span>{t('settlements.bankAccount')}</span>
                <strong>{target.bankAccount ?? t('settlements.noBankAccount')}</strong>
              </div>
            )}
          </div>
          <label className="modal-label">
            {t('settlements.payDate')}
            <DateField value={payDate} onChange={setPayDate} />
          </label>
          {error && <p style={{ color: '#c45b4d', fontSize: 12, margin: '12px 0 0' }}>{t(`errors.${error}`)}</p>}
          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary-button" disabled={pending || !payDate}>
              {pending ? t('common.processing') : t('settlements.markPaid')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

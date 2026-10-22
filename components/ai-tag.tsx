'use client'

import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

/** 원문 대신 AI 번역을 보여 줄 때 — 앞에 ✨, 글은 주황색 (문의 번역문과 같은 모양). ai가 아니면 글만 */
export function AiText({ ai, children }: { ai?: boolean; children: ReactNode }) {
  const t = useTranslations('common')
  if (!ai) return <>{children}</>
  return (
    <span className="ai-text">
      {/* 아이콘에 마우스를 올리면 "AI 자동번역" */}
      <span className="ai-text-icon" data-tip={t('aiTranslated')} aria-label={t('aiTranslated')}>
        <Sparkles size={12} />
      </span>
      {children}
    </span>
  )
}

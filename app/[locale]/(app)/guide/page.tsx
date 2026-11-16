import { getTranslations } from 'next-intl/server'
import { requireMenu } from '@/lib/server/auth/session'

// 이용 안내·자주 묻는 질문 (VELTRA 「利用方法」「よくある質問」). 읽기 전용 안내 페이지라 데이터는 없다.
// 질문을 늘릴 때는 messages/<언어>.json 의 guidePage.faq 에 q·a 를 추가하고 아래 FAQ_KEYS 에 키를 넣는다.
const FLOW_KEYS = ['register', 'review', 'live', 'change'] as const
const FAQ_KEYS = ['review', 'edit', 'autofill', 'translate', 'guideInfo', 'cancelBasis', 'password', 'contact'] as const

export default async function GuidePage() {
  await requireMenu('guide')
  const t = await getTranslations('guidePage')

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">GUIDE</p>
          <h1>{t('title')}</h1>
          <p className="heading-sub">{t('subtitle')}</p>
        </div>
      </section>

      <section className="card guide-flow">
        <h2>{t('flowTitle')}</h2>
        <ol>
          {FLOW_KEYS.map((k, i) => (
            <li key={k}>
              <span className="guide-flow-no">{i + 1}</span>
              <b>{t(`flow.${k}.title`)}</b>
              <p>{t(`flow.${k}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card guide-faq">
        <h2>{t('faqTitle')}</h2>
        {FAQ_KEYS.map((k) => (
          <details key={k}>
            <summary>{t(`faq.${k}.q`)}</summary>
            <p>{t(`faq.${k}.a`)}</p>
          </details>
        ))}
      </section>
    </>
  )
}

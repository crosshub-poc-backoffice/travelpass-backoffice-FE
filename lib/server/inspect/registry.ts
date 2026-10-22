// 검사기 등록 목록. 검사 항목을 늘릴 때 건드리는 유일한 파일 — 파이프라인 본체(pipeline.ts)는 그대로 둔다.
import { aiChecker } from './ai/run'
import { cancelRules } from './rules/cancel'
import { diffRules } from './rules/diff'
import { priceRules } from './rules/price'
import { scheduleRules } from './rules/schedule'
import type { Checker } from './types'

export const CHECKERS: Checker[] = [...priceRules, ...cancelRules, ...scheduleRules, ...diffRules, aiChecker]

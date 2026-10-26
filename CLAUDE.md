@AGENTS.md

# TravelPass 제휴사 백오피스

일본관광연맹 PoC 관리자 화면. 1차 데모 2026-10-20.
역할은 크로스허브–연맹(대행 업체 운영), 크로스허브–업체(직접 운영) 두 갈래. 연맹은 업체의 상위 권한이 아니다.
요구사항은 레포 상위 폴더(`../`)의 `기능요구사항.md`·`메뉴권한표.md`·`데이터모델.md` 기준. 문서에 없는 기능은 만들지 않는다.

## 작업 방식
- 팀이 Next.js에 익숙하지 않다. 작업 후 무엇을 어느 파일에서 바꿨는지 쉬운 말로 짧게 설명한다.
- 표준 패턴만 쓰고, 새 라이브러리는 추가 전에 물어본다. 패키지는 npm만.
- 커밋 전 `npm run typecheck`와 `npm run build` 통과.
- 커밋 메시지는 한국어. Claude/AI 작성 표시(Co-Authored-By 등)는 넣지 않는다.

## 구조
- DB 접근은 서버에서만: `import { prisma } from '@/lib/db'`. **읽기·쓰기 모두 하지 않는다** — 화면 데이터는 전부 BE API(`lib/api/backend.ts`)로 받고 바꾼다. 남은 DB 접근은 로그인 로그·접근 기록 쓰기(`lib/server/audit/access.ts`) 하나뿐이고, 이것도 BE 로 옮길 예정이다. 새 코드에서 `prisma`를 쓰지 않는다.
- 업무 로직은 `lib/server/<도메인>/`. Server Action·Route Handler는 로그인·권한 확인 → 입력 검증 → 서비스 호출만.
- 권한은 각 Server Action·Route Handler 안에서 확인한다. `proxy.ts`만 믿지 않는다.
- TP에 주는 API는 `/api/v1/...` + API 키.
- `lib/mock-data.ts`는 프로토타입 데이터. 화면을 DB로 옮기면서 걷어낸다.
- 화면은 `app/[locale]/` 아래, 주소는 항상 언어가 붙는다(`/ko/dashboard`). 링크·이동은 `@/i18n/navigation`의 `Link`·`useRouter`를 쓰고, 서버 코드의 이동은 `localePath()`(lib/server/auth/session.ts)로 언어를 붙인다.
- 새 UI 문구는 하드코딩하지 말고 `messages/<언어>.json`(next-intl)에 넣는다. ko는 필수이고 없는 키는 ko로 대체되지만, 가능하면 6개 언어를 다 채운다.
- 권한: 데이터를 바꾸는 Server Action은 `requireMenu('<메뉴>', 'edit')`, API는 `requireApiSession('<메뉴>', 'edit')`(lib/api/session.server.ts)로 확인한다.

## DB (Prisma 7 + Postgres)
- 로컬은 Docker DB(포트 5433). BE `./gradlew bootRun`이 켠다 (BE 레포 `infra/local/docker-compose.yml`) — BE를 먼저 띄우고 `npm run dev`. 배포(Vercel)는 Supabase. 개발 중에는 Supabase에 직접 붙지 않는다.
- Prisma 패키지는 7.10.0 고정. 버전 없이 `npm i prisma` 금지 (8.0 RC가 깔림).
- Client는 `@/lib/generated/prisma/client`에서 import (생성 파일, git 제외).
- 비밀값은 `.env`에만 (`.env.example` 참고). Supabase 주소는 Vercel 환경변수에만. 비밀값에 `NEXT_PUBLIC_` 금지.
- Supabase는 DB와 Storage로만 쓴다. Supabase Auth·RLS·Data API는 쓰지 않는다 (나중에 RDS 이전 대비).
- 이미지는 DB에 경로만 저장하고, 업로드 코드는 `lib/storage.ts`에 모은다.
- 시각은 `@db.Timestamptz`, 날짜만 있는 값(이용일·판매일)은 `@db.Date`, 금액은 `Int`, ID는 `@default(cuid())`.

## 마이그레이션
- 테이블 구조의 주인은 BE(Flyway)다. 스키마 변경은 BE 레포 `src/main/resources/db/migration/V<n>__<설명>.sql`로만 한다 (BE `docs/db-ownership-plan.md`). 머지된 V 파일은 고치지 않는다.
- FE에서 `prisma migrate dev`·`db push`로 마이그레이션을 만들지 않는다. `prisma/schema.prisma`는 Prisma Client 타입용 — BE 변경을 손으로 맞추고 `npx prisma generate`.
- `prisma/migrations`는 BE로 넘기기 전(56개)까지의 옛 이력. 고치지도, 새로 추가하지도 않는다.
- `npm run dev`는 로컬 DB 접속 확인(꺼져 있으면 BE를 먼저 띄우라고 멈춤) → 구조 확인(빈 DB면 BE를 먼저 띄우라고 멈춤, BE가 안 뜬 옛 Prisma DB면 옛 마이그레이션을 끝까지 맞춤) → Client 생성 → 시드 (scripts/dev.mjs).
- Vercel 빌드는 마이그레이션을 적용하지 않는다. Supabase 구조는 BE 기동 때 Flyway가 적용한다.
- Supabase에 `migrate dev`·`migrate reset`·`db push`를 돌리지 않는다.
- 테스트 데이터는 마이그레이션 말고 시드 스크립트로 (`npm run db:seed`).

## 참고 문서
- `HANDOVER.md` — 지금 어디까지 했는지 (세션 시작할 때 먼저 읽기)
- `docs/decisions/` — 되돌리기 어려운 결정을 왜 그렇게 했는지
- `docs/upstage-api.md` — Upstage API 호출 규칙과 이미 부딪힌 함정 (번역·문서 자동입력 건드리기 전에 읽기)

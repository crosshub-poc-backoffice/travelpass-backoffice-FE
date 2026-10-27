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
- **FE 는 DB 에 붙지 않는다.** 화면 데이터는 전부 BE API(`lib/api/backend.ts`)로 받고 바꾼다 — 로그인·접근 기록도 BE(`/api/v1/logs/*`). Prisma·`pg` 같은 DB 패키지를 다시 넣지 않는다. BE 에 없는 데이터가 필요하면 BE API 를 먼저 만든다.
- 업무 로직은 `lib/server/<도메인>/`. Server Action·Route Handler는 로그인·권한 확인 → 입력 검증 → 서비스 호출만.
- 권한은 각 Server Action·Route Handler 안에서 확인한다. `proxy.ts`만 믿지 않는다.
- `lib/mock-data.ts`는 프로토타입 데이터. 화면을 BE API로 옮기면서 걷어낸다.
- 화면은 `app/[locale]/` 아래, 주소는 항상 언어가 붙는다(`/ko/dashboard`). 링크·이동은 `@/i18n/navigation`의 `Link`·`useRouter`를 쓰고, 서버 코드의 이동은 `localePath()`(lib/server/auth/session.ts)로 언어를 붙인다.
- 새 UI 문구는 하드코딩하지 말고 `messages/<언어>.json`(next-intl)에 넣는다. ko는 필수이고 없는 키는 ko로 대체되지만, 가능하면 6개 언어를 다 채운다.
- 권한: 데이터를 바꾸는 Server Action은 `requireMenu('<메뉴>', 'edit')`, API는 `requireApiSession('<메뉴>', 'edit')`(lib/api/session.server.ts)로 확인한다.

## 데이터·환경
- 실행 순서: BE `./gradlew bootRun`(로컬 DB 컨테이너·Flyway 를 BE 가 맡는다) → FE `npm run dev`. FE 는 `BACKEND_API_URL` 로 BE 에 붙는다.
- 테이블 구조·데모 데이터의 주인은 BE 다: 스키마 변경은 BE `src/main/resources/db/migration/V<n>__<설명>.sql`, 데모 데이터는 BE `infra/local/demo`(`npm run seed`·`npm run reset`).
- `npm run dev`(scripts/dev.mjs)는 BE 가 응답하는지 확인(안 되면 안내만) → 로컬 Redis(세션) 켜기 → 개발 서버.
- 비밀값은 `.env`에만 (`.env.example` 참고). 비밀값에 `NEXT_PUBLIC_` 금지.
- 설정은 코드에 기본값을 두지 않는다. 새 설정은 `lib/env.mjs` 의 `REQUIRED_ENV` 와 `.env.example` 에 같이 넣고 `env('이름')` 으로 읽는다 (빠지면 시작할 때 멈춘다).
- 이미지는 경로만 저장하고, 파일 저장(사진·사업자등록증·소개서)과 Upstage 호출은 BE 가 한다 — FE 라우트(`app/api/*`)는 `forward()`로 넘기기만 한다.
- BE 응답의 enum(예약 상태 등)은 FE 가 자기 타입으로 둔다 (`lib/bookings/status.ts` 등). BE 와 값이 달라지지 않게 같이 고친다.

## 참고 문서
- `HANDOVER.md` — 지금 어디까지 했는지 (세션 시작할 때 먼저 읽기)
- `docs/decisions/` — 되돌리기 어려운 결정을 왜 그렇게 했는지
- `docs/upstage-api.md` — Upstage API 호출 규칙과 이미 부딪힌 함정 (번역·문서 자동입력 건드리기 전에 읽기)

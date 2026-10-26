# TravelPass 제휴사 백오피스

일본관광연맹 PoC 관리자 화면. Next.js 16 + Prisma 7 + PostgreSQL.
로컬은 Docker DB와 Docker 사진 저장소(RustFS)를 쓰고, 배포는 Vercel + Supabase. 로컬 개발에는 `.env`가 필요 없다.

## 처음 한 번

Docker Desktop을 켠 뒤:

```bash
npm install && npm run dev
```

http://localhost:3000/ko 로 접속한다.

## 상황별 명령

| 언제 | 명령 |
|---|---|
| 작업 시작, 동료 코드를 받은 뒤 | `npm run dev` (패키지가 바뀌었으면 먼저 `npm install`) |
| DB 구조를 바꿀 때 | BE에 `src/main/resources/db/migration/V<n>__<설명>.sql` 추가 → BE 재기동 → FE `prisma/schema.prisma`를 손으로 맞추고 `npx prisma generate` |
| 로컬 DB가 꼬였을 때 | BE README의 "로컬 DB를 처음부터 다시 만들려면" (BE에서 DB 다시 만들기 → BE 실행 → `npm run dev`) |
| DB를 표로 볼 때 | `npm run db:studio` |
| 커밋 전 | `npm run typecheck && npm run build` |

`npm run dev`가 시작할 때 알아서 하는 것: 로컬 DB 접속 확인 → 테이블 구조 확인 → Prisma Client 생성 → 테스트 계정을 기본값으로 맞추기 → 개발 서버.
테이블 구조는 BE가 기동할 때 Flyway로 맞춘다. 로컬 DB가 비어 있으면 BE를 먼저 한 번 띄우라고 안내하고 멈춘다.
실행 순서: **BE `./gradlew bootRun` → FE `npm run dev`.** 로컬 DB(Docker)는 BE가 뜰 때 알아서 켠다 (BE를 꺼도 DB는 계속 켜져 있다).
로그인 세션은 FE 전용 Redis 에 둔다 (`infra/redis/docker-compose.yml`, `npm run dev` 가 켠다. 운영은 `REDIS_URL` 에 Upstash). 로컬 컨테이너 전체는 BE 레포 `docs/local-infra.md`. 역할·업체 범위는 BE `GET /api/v1/me` 로 받는다.
Keycloak은 처음 한 번만 인증 서버 레포 `keycloak-auth`에서 켜 두면 Docker Desktop이 켜질 때 같이 뜬다.

## 테스트 계정 (로컬)

비밀번호는 Keycloak에 있다. `keycloak-auth`에서 `bash scripts/reset-password.sh <아이디> '<임시비번>'`로 넣고 첫 로그인 때 바꾼다.

| ID | 역할 | 볼 수 있는 업체 |
|---|---|---|
| test-crosshub | 크로스허브 | 전체 4곳 |
| test-federation | 연맹 | 대행 업체 2곳 (나가사키크루즈, 고토열도 소규모 민박) |
| test-partner | 업체 | 벳푸온천관광(주) |

## 마이그레이션 규칙

- 테이블 구조의 주인은 **BE(Flyway)**다. 스키마 변경은 BE `src/main/resources/db/migration/V<n>__<설명>.sql`로만 한다 (BE `docs/db-ownership-plan.md`).
- FE에서는 마이그레이션을 만들지 않는다. `prisma/schema.prisma`는 Prisma Client 타입용이라, BE 변경을 손으로 맞추고 `npx prisma generate`만 한다.
- `prisma/migrations/`는 BE로 넘기기 전(56개)까지의 옛 이력이다. 그대로 두고 고치지 않는다.
- Vercel 배포는 더 이상 Supabase에 마이그레이션을 적용하지 않는다. BE가 배포·기동될 때 적용한다.
- Supabase에는 `migrate dev`·`reset`·`db push`를 직접 돌리지 않는다.

## 배포 (Vercel)

Vercel 환경변수(Production)에 Supabase 주소 두 개를 넣는다. 값은 Supabase 대시보드 > Connect에서 복사한다.

| 변수 | 값 |
|---|---|
| `DATABASE_URL` | Transaction pooler (포트 6543), 앱 실행용 |
| `DIRECT_URL` | Session pooler (포트 5432), 배포 때 마이그레이션용 |

## 폴더

| 위치 | 내용 |
|---|---|
| `app/[locale]/<메뉴>/` | 화면 (주소: `/ko/dashboard`). 메뉴마다 `layout.tsx`가 로그인·메뉴 권한을 확인한다 |
| `app/actions/`, `app/[locale]/<메뉴>/actions.ts` | Server Action (권한 확인 → 입력 검증 → 서비스 호출) |
| `app/api/` | API (`lib/api/session.server.ts`로 로그인·권한 확인) |
| `lib/server/<도메인>/` | 업무 로직·DB 접근 |
| `lib/permissions.ts` | 역할별 메뉴 권한 (메뉴권한표) |
| `messages/<언어>.json`, `i18n/` | 화면 문구와 언어 설정 (next-intl) |
| `lib/mock-data.ts` | 아직 DB로 안 옮긴 화면의 목업 데이터 |
| `prisma/` | 스키마, 마이그레이션, 시드 |

새 메뉴를 만들 때는 `lib/permissions.ts`, `components/shell.tsx`의 `NAV_ITEMS`, 메뉴 폴더의 `layout.tsx` 세 곳을 같이 고친다. 작업 규칙은 `CLAUDE.md` 참고.

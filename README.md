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
| DB 구조를 바꿀 때 | `prisma/schema.prisma` 수정 → `npm run db:migrate` → 이름을 물어보면 영어로 짧게 (예: add_products) |
| 로컬 DB가 꼬였을 때 | `npm run db:reset` (로컬 데이터를 지우고 테이블·테스트 계정을 다시) |
| DB를 표로 볼 때 | `npm run db:studio` |
| 커밋 전 | `npm run typecheck && npm run build` |

`npm run dev`가 시작할 때 알아서 하는 것: 로컬 DB(Docker) 켜기 → 동료 마이그레이션 등 밀린 것 적용 → Prisma Client 생성 → 테스트 계정을 기본값으로 맞추기 → 개발 서버.
DB는 `npm run db:down`으로 끈다. 데이터는 그대로 남는다.

## 테스트 계정 (로컬)

비밀번호는 셋 다 `prisma/seed.ts`의 `LOCAL_SEED_PASSWORD`.

| ID | 역할 | 볼 수 있는 업체 |
|---|---|---|
| test-crosshub | 크로스허브 | 전체 4곳 |
| test-federation | 연맹 | 대행 업체 2곳 (나가사키크루즈, 고토열도 소규모 민박) |
| test-partner | 업체 | 벳푸온천관광(주) |

## 마이그레이션 규칙

- `db:migrate`로 생긴 `prisma/migrations/` 폴더는 `schema.prisma`와 같이 커밋한다. 올리기 전에 main을 받아 `npm run dev`로 한 번 띄워 본다.
- main에 머지되면 Vercel production 배포 때 Supabase에 자동으로 적용된다. 실패하면 배포가 멈추고 이전 버전이 유지된다. Preview 배포는 건너뛴다.
- Supabase에는 `migrate dev`·`reset`·`db push`를 직접 돌리지 않는다.
- main에 머지된 마이그레이션 파일은 고치지 않는다. 바꿀 게 있으면 새로 만든다.

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

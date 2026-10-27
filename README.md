# TravelPass 제휴사 백오피스

일본관광연맹 PoC 관리자 화면. Next.js 16. **DB 에 붙지 않는다** — 데이터는 전부 BE(Spring, `travelpass-backoffice-BE`) API 로 받는다.
로컬은 BE·Docker 사진 저장소(RustFS)·Redis 를 쓰고, 배포는 Vercel.

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
| DB 구조를 바꿀 때 | BE에 `src/main/resources/db/migration/V<n>__<설명>.sql` 추가 → BE 재기동 (FE 는 할 일 없음. 화면에 필요한 값은 BE API 응답에 넣는다) |
| 데모 데이터를 넣거나 되돌릴 때 | BE `infra/local/demo` 에서 `npm install` 후 `npm run seed`(빈 DB만) / `npm run reset`(통째로 데모로) |
| 로컬 DB가 꼬였을 때 | BE README의 "로컬 DB를 처음부터 다시 만들려면" |
| 커밋 전 | `npm run typecheck && npm run build` |

`npm run dev`가 시작할 때 알아서 하는 것: BE 가 응답하는지 확인(안 되면 안내) → 로컬 Redis 켜기 → 개발 서버.
실행 순서: **BE `./gradlew bootRun` → FE `npm run dev`.** 로컬 DB(Docker)와 테이블 구조(Flyway)는 BE 가 맡는다.
로그인 세션은 FE 전용 Redis 에 둔다 (`infra/redis/docker-compose.yml`, `npm run dev` 가 켠다. 운영은 `REDIS_URL` 에 Upstash). 로컬 컨테이너 전체는 BE 레포 `docs/local-infra.md`. 역할·업체 범위는 BE `GET /api/v1/me` 로 받는다.
Keycloak은 처음 한 번만 인증 서버 레포 `keycloak-auth`에서 켜 두면 Docker Desktop이 켜질 때 같이 뜬다.

## 테스트 계정 (로컬)

비밀번호는 Keycloak에 있다. `keycloak-auth`에서 `bash scripts/reset-password.sh <아이디> '<임시비번>'`로 넣고 첫 로그인 때 바꾼다.

| ID | 역할 | 볼 수 있는 업체 |
|---|---|---|
| test-crosshub | 크로스허브 | 전체 4곳 |
| test-federation | 연맹 | 대행 업체 2곳 (나가사키크루즈, 고토열도 소규모 민박) |
| test-partner | 업체 | 벳푸온천관광(주) |

## 배포 (Vercel)

FE 에는 DB 접속 정보를 넣지 않는다. 설정 6개(BE 주소·Keycloak·세션 암호화 키·Redis)는 `.env.example` 을 `.env` 로 복사해 채운다. 코드에 기본값이 없어서 빠진 값이 있으면 `npm run dev` 가 이름을 알려주고 멈춘다.
예전에 넣어 둔 `DATABASE_URL`·`DIRECT_URL` 은 지운다.

## 폴더

| 위치 | 내용 |
|---|---|
| `app/[locale]/<메뉴>/` | 화면 (주소: `/ko/dashboard`). 메뉴마다 `layout.tsx`가 로그인·메뉴 권한을 확인한다 |
| `app/actions/`, `app/[locale]/<메뉴>/actions.ts` | Server Action (권한 확인 → 입력 검증 → 서비스 호출) |
| `app/api/` | API (`lib/api/session.server.ts`로 로그인·권한 확인) |
| `lib/server/<도메인>/` | 업무 로직 (BE API 호출, `lib/api/backend.ts`) |
| `lib/permissions.ts` | 역할별 메뉴 권한 (메뉴권한표) |
| `messages/<언어>.json`, `i18n/` | 화면 문구와 언어 설정 (next-intl) |
| `lib/mock-data.ts` | 아직 BE API로 안 옮긴 화면의 목업 데이터 |

새 메뉴를 만들 때는 `lib/permissions.ts`, `components/shell.tsx`의 `NAV_ITEMS`, 메뉴 폴더의 `layout.tsx` 세 곳을 같이 고친다. 작업 규칙은 `CLAUDE.md` 참고.

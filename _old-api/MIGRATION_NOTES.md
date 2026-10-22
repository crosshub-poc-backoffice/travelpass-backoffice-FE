# FE → BE 이관 메모

poc-backoffice-v1(Next.js 풀스택)을 FE/BE로 분리하며 생긴 메모.
BE는 `../poc-backoffice-BE`(Spring Boot).

## 이미 처리한 것
- FE는 v1 전체 복사본(node_modules·.next·.vercel 제외).
- Next.js API 라우트(`app/api/**`)는 이 폴더(`_moved-to-BE/app-api`)로 **이동**해 보관. (삭제 아님)

## BE로 옮겨야 할 것 (아직 FE에 남아 있음)
현재 FE는 아직 v1처럼 서버 코드를 품고 있어 그대로는 "분리"가 끝난 게 아니다. 다음을 BE로 이관하고 FE는 그 API를 호출하도록 바꿔야 한다.

- `prisma/` + `lib/generated/prisma` : DB 접근(Prisma) → BE의 JPA로 대체됨. BE가 같은 Postgres를 재사용.
- `lib/server/**` : 서버 전용 데이터·비즈니스 로직 (products/bookings/inquiries/settlements/partners/inspect/…) → BE 도메인으로 이관.
- `app/actions/**` (server actions) : BE API 호출로 교체.
- `_moved-to-BE/app-api/**` : 위 API들을 BE 컨트롤러로 재구현.

## 진행 상황
- [x] products 조회 API (GET 목록/상세) → BE 완료
- [ ] products 생성/수정 (POST/PUT) + 업체 범위(sub→company_member)
- [ ] bookings / inquiries / inspect / notifications
- [ ] FE 데이터 접근을 BE API로 repoint (axios + Keycloak 토큰)

## 삭제 안내
`app-api`와 BE로 옮긴 `prisma`·`lib/server`는 이관·검증이 끝난 뒤 직접 삭제하면 된다.

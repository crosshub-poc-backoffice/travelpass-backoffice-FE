-- 연맹·업체 계정 이름을 소속명으로 맞춘다 (소속당 계정 1개, 이름 = 소속명).
-- 크로스허브 계정은 소속이 없어 담당자 이름을 그대로 둔다. 데이터만 바꾸고 테이블 구조는 그대로
UPDATE "User" u SET "name" = p."name" FROM "Partner" p WHERE u."partnerId" = p."id";
UPDATE "User" u SET "name" = a."name" FROM "Affiliate" a WHERE u."affiliateId" = a."id";

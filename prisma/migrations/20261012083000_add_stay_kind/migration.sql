-- 연박(stay) 종류 추가. 박수가 있는 플랜을 가진 날짜 상품(합쳐졌던 패키지)은 연박으로 옮긴다
BEGIN;
CREATE TYPE "ProductKind_new" AS ENUM ('time', 'date', 'stay', 'pass');
ALTER TABLE "Product" ALTER COLUMN "kind" TYPE "ProductKind_new" USING ("kind"::text::"ProductKind_new");
ALTER TYPE "ProductKind" RENAME TO "ProductKind_old";
ALTER TYPE "ProductKind_new" RENAME TO "ProductKind";
DROP TYPE "ProductKind_old";
COMMIT;

UPDATE "Product" SET "kind" = 'stay'
WHERE "kind" = 'date'
  AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("detail"->'plans', '[]'::jsonb)) p WHERE COALESCE((p->>'nights')::int, 0) > 0)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE("detail"->'days', '[]'::jsonb)) d WHERE COALESCE((d->>'nights')::int, 0) > 0)
  );

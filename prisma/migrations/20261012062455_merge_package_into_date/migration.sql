-- 패키지 종류를 날짜만(date) 상품으로 합친다. 기존 패키지 상품은 날짜만 상품이 되고, 박수는 요금 플랜에 들어간다 (lib/products/validate.ts가 읽을 때 변환)
UPDATE "Product" SET "kind" = 'date' WHERE "kind" = 'package';

-- AlterEnum
BEGIN;
CREATE TYPE "ProductKind_new" AS ENUM ('time', 'date', 'pass');
ALTER TABLE "Product" ALTER COLUMN "kind" TYPE "ProductKind_new" USING ("kind"::text::"ProductKind_new");
ALTER TYPE "ProductKind" RENAME TO "ProductKind_old";
ALTER TYPE "ProductKind_new" RENAME TO "ProductKind";
DROP TYPE "ProductKind_old";
COMMIT;

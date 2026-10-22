-- detail(JSON)을 priceTable·blocks 두 컬럼으로 나눈다. 기존 값은 버리지 않고 옮겨 담는다.

-- AlterTable: 일단 priceTable 없이, blocks만 기본값과 함께 추가
ALTER TABLE "Product" ADD COLUMN     "blocks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "priceTable" JSONB;

-- Backfill: 기존 detail의 조각들을 새 컬럼으로 옮긴다
UPDATE "Product"
SET
  "priceTable" = jsonb_build_object(
    'categories', COALESCE("detail"->'categories', '[]'::jsonb),
    'plans', COALESCE("detail"->'plans', '[]'::jsonb),
    'priceImages', COALESCE("detail"->'priceImages', '[]'::jsonb),
    'priceText', COALESCE("detail"->'priceText', '""'::jsonb)
  ),
  "blocks" = COALESCE("detail"->'blocks', '[]'::jsonb);

-- 이제서야 NOT NULL로 잠그고 detail은 지운다
ALTER TABLE "Product" ALTER COLUMN "priceTable" SET NOT NULL;
ALTER TABLE "Product" DROP COLUMN "detail";

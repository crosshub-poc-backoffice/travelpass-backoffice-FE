-- 업체 비활성화로 자동 숨김된 상품 표시. 다시 활성화할 때 이것만 되돌린다
ALTER TABLE "Product" ADD COLUMN "hiddenByPartnerOff" BOOLEAN NOT NULL DEFAULT false;

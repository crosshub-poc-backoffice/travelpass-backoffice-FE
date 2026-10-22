-- AlterTable
ALTER TABLE "InquiryMessage" ADD COLUMN     "textLocale" TEXT;

-- 지금까지의 관리자 답변은 전부 한국어 화면에서 쓴 것이라 ko로 채운다.
UPDATE "InquiryMessage" SET "textLocale" = 'ko' WHERE "sender" = 'admin';

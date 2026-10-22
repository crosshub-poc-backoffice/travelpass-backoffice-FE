-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "questionTranslatedLocale" TEXT;

-- AlterTable
ALTER TABLE "InquiryMessage" ADD COLUMN     "translatedLocale" TEXT;

-- 지금까지 저장된 고객 문의 번역문은 전부 한국어 화면에서 만든 것이라 ko로 채운다.
-- (관리자 답변의 번역문은 문의 언어로 고정이라 언어를 따로 적지 않는다)
UPDATE "Inquiry" SET "questionTranslatedLocale" = 'ko' WHERE "questionTranslated" <> '';
UPDATE "InquiryMessage" SET "translatedLocale" = 'ko' WHERE "sender" = 'customer' AND "textTranslated" IS NOT NULL;

-- 국적을 한국어 국가명에서 ISO 국가코드로 바꾼다. 목록에 없는 값은 그대로 두고, 화면은 코드가 아니면 원래 글자를 보여준다.
UPDATE "Booking" b SET "nationality" = m.code
FROM (VALUES
  ('대한민국', 'KR'), ('한국', 'KR'), ('일본', 'JP'), ('중국', 'CN'), ('대만', 'TW'), ('홍콩', 'HK'),
  ('마카오', 'MO'), ('베트남', 'VN'), ('태국', 'TH'), ('싱가포르', 'SG'), ('말레이시아', 'MY'),
  ('인도네시아', 'ID'), ('필리핀', 'PH'), ('인도', 'IN'), ('미국', 'US'), ('캐나다', 'CA'),
  ('호주', 'AU'), ('뉴질랜드', 'NZ'), ('영국', 'GB'), ('프랑스', 'FR'), ('독일', 'DE'),
  ('이탈리아', 'IT'), ('스페인', 'ES'), ('폴란드', 'PL'), ('네덜란드', 'NL'), ('러시아', 'RU')
) AS m(name, code)
WHERE b."nationality" = m.name;

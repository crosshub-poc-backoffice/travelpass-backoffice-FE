-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('time', 'date', 'pass', 'package');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('review', 'live', 'hidden');

-- AlterTable
-- 이미 상품 행이 있는 DB에서도 깨지지 않게, 필수 칸(kind·name·detail)은 임시 기본값으로 채운 뒤 기본값을 지운다.
-- 그렇게 채워진 옛 행은 "체험·투어 / 이름 빈칸 / 심사중"이 되므로 화면에서 다시 입력하면 된다.
ALTER TABLE "Product" ADD COLUMN     "area" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cancelPolicy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "confirmType" "ConfirmType" NOT NULL DEFAULT 'instant',
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "detail" JSONB NOT NULL DEFAULT '{"kind":"time","slots":[{"time":"10:00","capacity":10}],"durationHours":"","meetingPoint":"","closedDays":[],"cutoffDays":1,"plans":[{"name":"","adult":null,"child":null}],"extras":[]}',
ADD COLUMN     "kind" "ProductKind" NOT NULL DEFAULT 'time',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "priceFrom" INTEGER,
ADD COLUMN     "saleEnd" DATE,
ADD COLUMN     "saleStart" DATE,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'review';

ALTER TABLE "Product" ALTER COLUMN "detail" DROP DEFAULT,
ALTER COLUMN "kind" DROP DEFAULT,
ALTER COLUMN "name" DROP DEFAULT;

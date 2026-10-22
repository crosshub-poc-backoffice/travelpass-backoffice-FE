-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "bankAccount",
ADD COLUMN     "bankAccountHolder" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;


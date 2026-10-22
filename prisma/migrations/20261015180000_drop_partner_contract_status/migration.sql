-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "contractEndDate",
DROP COLUMN "contractStartDate",
DROP COLUMN "operatingStatus";

-- DropEnum
DROP TYPE "OperatingStatus";


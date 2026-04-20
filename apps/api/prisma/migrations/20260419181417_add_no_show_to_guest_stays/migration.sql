-- CreateEnum
CREATE TYPE "NoShowChargeStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'CHARGED', 'FAILED', 'WAIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "journey_event_type" ADD VALUE 'NO_SHOW_MARKED';
ALTER TYPE "journey_event_type" ADD VALUE 'NO_SHOW_REVERTED';

-- AlterEnum
ALTER TYPE "stay_journey_status" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "guest_stays" ADD COLUMN     "no_show_at" TIMESTAMP(3),
ADD COLUMN     "no_show_by_id" TEXT,
ADD COLUMN     "no_show_charge_status" "NoShowChargeStatus",
ADD COLUMN     "no_show_fee_amount" DECIMAL(10,2),
ADD COLUMN     "no_show_fee_currency" TEXT,
ADD COLUMN     "no_show_reason" TEXT,
ADD COLUMN     "no_show_reverted_at" TIMESTAMP(3),
ADD COLUMN     "no_show_reverted_by_id" TEXT;

-- AlterTable
ALTER TABLE "property_settings" ADD COLUMN     "no_show_cutoff_hour" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "no_show_processed_date" DATE;

-- CreateIndex
CREATE INDEX "guest_stays_no_show_at_idx" ON "guest_stays"("no_show_at");

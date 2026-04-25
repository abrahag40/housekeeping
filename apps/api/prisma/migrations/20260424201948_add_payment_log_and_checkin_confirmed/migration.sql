-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'CARD_TERMINAL', 'BANK_TRANSFER', 'OTA_PREPAID', 'COMP');

-- AlterEnum
ALTER TYPE "journey_event_type" ADD VALUE 'CHECKED_IN';

-- CreateTable
CREATE TABLE "payment_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "stay_id" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "reference" TEXT,
    "approved_by_id" TEXT,
    "approval_reason" TEXT,
    "is_void" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    "voids_log_id" TEXT,
    "shift_date" DATE NOT NULL,
    "collected_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_logs_voids_log_id_key" ON "payment_logs"("voids_log_id");

-- CreateIndex
CREATE INDEX "payment_logs_stay_id_idx" ON "payment_logs"("stay_id");

-- CreateIndex
CREATE INDEX "payment_logs_organization_id_property_id_shift_date_idx" ON "payment_logs"("organization_id", "property_id", "shift_date");

-- CreateIndex
CREATE INDEX "payment_logs_collected_by_id_shift_date_idx" ON "payment_logs"("collected_by_id", "shift_date");

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "guest_stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_collected_by_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_logs" ADD CONSTRAINT "payment_logs_voids_log_id_fkey" FOREIGN KEY ("voids_log_id") REFERENCES "payment_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "property_settings" ADD COLUMN     "enable_auto_outreach" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "potential_no_show_processed_date" DATE,
ADD COLUMN     "potential_no_show_warning_hour" INTEGER NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "guest_contact_logs" (
    "id" TEXT NOT NULL,
    "stay_id" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "sent_by_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_preview" TEXT,

    CONSTRAINT "guest_contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_contact_logs_stay_id_idx" ON "guest_contact_logs"("stay_id");

-- CreateIndex
CREATE INDEX "guest_contact_logs_sent_at_idx" ON "guest_contact_logs"("sent_at");

-- AddForeignKey
ALTER TABLE "guest_contact_logs" ADD CONSTRAINT "guest_contact_logs_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "guest_stays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_contact_logs" ADD CONSTRAINT "guest_contact_logs_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

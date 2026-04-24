-- DropForeignKey
ALTER TABLE "guest_contact_logs" DROP CONSTRAINT "guest_contact_logs_sent_by_id_fkey";

-- AlterTable
ALTER TABLE "guest_contact_logs" ALTER COLUMN "sent_by_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "guest_contact_logs" ADD CONSTRAINT "guest_contact_logs_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "AppNotificationType" AS ENUM ('INFORMATIONAL', 'ACTION_REQUIRED', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "AppNotificationCategory" AS ENUM ('CHECKIN_UNCONFIRMED', 'EARLY_CHECKOUT', 'NO_SHOW', 'NO_SHOW_REVERTED', 'ARRIVAL_RISK', 'CHECKOUT_COMPLETE', 'TASK_COMPLETED', 'MAINTENANCE_REPORTED', 'PAYMENT_PENDING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AppNotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationRecipient" AS ENUM ('USER', 'ROLE', 'PROPERTY_ALL');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED');

-- AlterTable
ALTER TABLE "guest_stays" ADD COLUMN     "actual_checkin" TIMESTAMP(3),
ADD COLUMN     "checkin_confirmed_by_id" TEXT;

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT,
    "type" "AppNotificationType" NOT NULL,
    "category" "AppNotificationCategory" NOT NULL,
    "priority" "AppNotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "action_url" TEXT,
    "recipient_type" "NotificationRecipient" NOT NULL,
    "recipient_id" TEXT,
    "recipient_role" "HousekeepingRole",
    "triggered_by_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notification_reads" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "read_by_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_notification_approvals" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "action" "ApprovalDecision" NOT NULL,
    "action_by_id" TEXT NOT NULL,
    "action_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "app_notification_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_notifications_organization_id_property_id_created_at_idx" ON "app_notifications"("organization_id", "property_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "app_notifications_recipient_id_idx" ON "app_notifications"("recipient_id");

-- CreateIndex
CREATE INDEX "app_notifications_recipient_role_idx" ON "app_notifications"("recipient_role");

-- CreateIndex
CREATE UNIQUE INDEX "app_notification_reads_notification_id_read_by_id_key" ON "app_notification_reads"("notification_id", "read_by_id");

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notification_reads" ADD CONSTRAINT "app_notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "app_notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notification_reads" ADD CONSTRAINT "app_notification_reads_read_by_id_fkey" FOREIGN KEY ("read_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notification_approvals" ADD CONSTRAINT "app_notification_approvals_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "app_notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notification_approvals" ADD CONSTRAINT "app_notification_approvals_action_by_id_fkey" FOREIGN KEY ("action_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

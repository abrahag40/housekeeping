-- CreateEnum
CREATE TYPE "BlockSemantic" AS ENUM ('OUT_OF_SERVICE', 'OUT_OF_ORDER', 'OUT_OF_INVENTORY', 'HOUSE_USE');

-- CreateEnum
CREATE TYPE "BlockReason" AS ENUM ('MAINTENANCE', 'DEEP_CLEANING', 'INSPECTION', 'PHOTOGRAPHY', 'VIP_SETUP', 'PEST_CONTROL', 'WATER_DAMAGE', 'ELECTRICAL', 'PLUMBING', 'STRUCTURAL', 'RENOVATION', 'OWNER_STAY', 'STAFF_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "BlockStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BlockLogEvent" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'ACTIVATED', 'EXTENDED', 'EARLY_RELEASE', 'CANCELLED', 'EXPIRED', 'NOTE_ADDED');

-- CreateTable
CREATE TABLE "room_blocks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_id" TEXT,
    "bed_id" TEXT,
    "semantic" "BlockSemantic" NOT NULL,
    "reason" "BlockReason" NOT NULL,
    "status" "BlockStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "notes" TEXT,
    "internal_notes" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approval_notes" TEXT,
    "approved_at" TIMESTAMP(3),
    "cleaning_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_logs" (
    "id" TEXT NOT NULL,
    "block_id" TEXT NOT NULL,
    "staff_id" TEXT,
    "event" "BlockLogEvent" NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_blocks_cleaning_task_id_key" ON "room_blocks"("cleaning_task_id");

-- CreateIndex
CREATE INDEX "room_blocks_organization_id_property_id_status_idx" ON "room_blocks"("organization_id", "property_id", "status");

-- CreateIndex
CREATE INDEX "room_blocks_bed_id_status_idx" ON "room_blocks"("bed_id", "status");

-- CreateIndex
CREATE INDEX "room_blocks_room_id_status_idx" ON "room_blocks"("room_id", "status");

-- CreateIndex
CREATE INDEX "room_blocks_start_date_end_date_idx" ON "room_blocks"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "block_logs_block_id_idx" ON "block_logs"("block_id");

-- CreateIndex
CREATE INDEX "block_logs_created_at_idx" ON "block_logs"("created_at");

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_bed_id_fkey" FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_cleaning_task_id_fkey" FOREIGN KEY ("cleaning_task_id") REFERENCES "cleaning_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_logs" ADD CONSTRAINT "block_logs_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "room_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_logs" ADD CONSTRAINT "block_logs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "housekeeping_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

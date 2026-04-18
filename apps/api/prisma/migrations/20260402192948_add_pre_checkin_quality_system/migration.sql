-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'NEEDS_MAINTENANCE', 'READY', 'APPROVED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'DONE', 'ISSUE_FOUND', 'SKIPPED');

-- CreateTable
CREATE TABLE "room_type_checklists" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_type_id" TEXT,
    "name" TEXT NOT NULL,
    "triggerOn" TEXT NOT NULL DEFAULT 'checkout',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_type_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "requires_photo" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_readiness_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "assigned_to_id" TEXT,
    "triggered_by" TEXT NOT NULL,
    "status" "ReadinessStatus" NOT NULL DEFAULT 'PENDING',
    "due_by" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_readiness_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_readiness_task_items" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "checklist_item_id" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "photo_url" TEXT,
    "notes" TEXT,
    "maintenance_ticket_id" TEXT,

    CONSTRAINT "room_readiness_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_type_checklists_organization_id_idx" ON "room_type_checklists"("organization_id");

-- CreateIndex
CREATE INDEX "room_type_checklists_organization_id_property_id_idx" ON "room_type_checklists"("organization_id", "property_id");

-- CreateIndex
CREATE INDEX "checklist_items_checklist_id_idx" ON "checklist_items"("checklist_id");

-- CreateIndex
CREATE INDEX "room_readiness_tasks_organization_id_idx" ON "room_readiness_tasks"("organization_id");

-- CreateIndex
CREATE INDEX "room_readiness_tasks_room_id_status_idx" ON "room_readiness_tasks"("room_id", "status");

-- CreateIndex
CREATE INDEX "room_readiness_task_items_task_id_idx" ON "room_readiness_task_items"("task_id");

-- AddForeignKey
ALTER TABLE "room_type_checklists" ADD CONSTRAINT "room_type_checklists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "room_type_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_readiness_tasks" ADD CONSTRAINT "room_readiness_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_readiness_tasks" ADD CONSTRAINT "room_readiness_tasks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_readiness_tasks" ADD CONSTRAINT "room_readiness_tasks_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "room_type_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_readiness_task_items" ADD CONSTRAINT "room_readiness_task_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "room_readiness_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_readiness_task_items" ADD CONSTRAINT "room_readiness_task_items_checklist_item_id_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

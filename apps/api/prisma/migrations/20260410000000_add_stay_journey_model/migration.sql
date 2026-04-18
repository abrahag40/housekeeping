-- CreateEnum
CREATE TYPE "stay_journey_status" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "segment_status" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "segment_reason" AS ENUM ('ORIGINAL', 'EXTENSION_SAME_ROOM', 'EXTENSION_NEW_ROOM', 'ROOM_MOVE');

-- CreateEnum
CREATE TYPE "night_status" AS ENUM ('PENDING', 'POSTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "journey_event_type" AS ENUM ('JOURNEY_CREATED', 'SEGMENT_ADDED', 'SEGMENT_LOCKED', 'ROOM_MOVE_EXECUTED', 'EXTENSION_APPROVED', 'CHECKED_OUT', 'CANCELLED');

-- CreateTable
CREATE TABLE "stay_journeys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "guest_stay_id" TEXT,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT,
    "status" "stay_journey_status" NOT NULL DEFAULT 'ACTIVE',
    "journey_check_in" TIMESTAMP(3) NOT NULL,
    "journey_check_out" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stay_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_segments" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "guest_stay_id" TEXT,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3) NOT NULL,
    "status" "segment_status" NOT NULL DEFAULT 'PENDING',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "reason" "segment_reason" NOT NULL DEFAULT 'ORIGINAL',
    "rate_snapshot" DECIMAL(10,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stay_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_nights" (
    "id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "status" "night_status" NOT NULL DEFAULT 'PENDING',
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "segment_nights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_journey_events" (
    "id" TEXT NOT NULL,
    "journey_id" TEXT NOT NULL,
    "event_type" "journey_event_type" NOT NULL,
    "actor_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_journey_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stay_journeys_guest_stay_id_key" ON "stay_journeys"("guest_stay_id");

-- CreateIndex
CREATE INDEX "stay_journeys_organization_id_status_idx" ON "stay_journeys"("organization_id", "status");

-- CreateIndex
CREATE INDEX "stay_journeys_property_id_journey_check_in_journey_check_ou_idx" ON "stay_journeys"("property_id", "journey_check_in", "journey_check_out");

-- CreateIndex
CREATE INDEX "stay_segments_journey_id_idx" ON "stay_segments"("journey_id");

-- CreateIndex
CREATE INDEX "stay_segments_room_id_check_in_check_out_idx" ON "stay_segments"("room_id", "check_in", "check_out");

-- CreateIndex
CREATE INDEX "stay_segments_status_locked_idx" ON "stay_segments"("status", "locked");

-- CreateIndex
CREATE INDEX "segment_nights_date_idx" ON "segment_nights"("date");

-- CreateIndex
CREATE INDEX "segment_nights_segment_id_locked_idx" ON "segment_nights"("segment_id", "locked");

-- CreateIndex
CREATE UNIQUE INDEX "segment_nights_segment_id_date_key" ON "segment_nights"("segment_id", "date");

-- CreateIndex
CREATE INDEX "stay_journey_events_journey_id_occurred_at_idx" ON "stay_journey_events"("journey_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stay_journey_events_event_type_occurred_at_idx" ON "stay_journey_events"("event_type", "occurred_at");

-- AddForeignKey
ALTER TABLE "stay_journeys" ADD CONSTRAINT "stay_journeys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_journeys" ADD CONSTRAINT "stay_journeys_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_journeys" ADD CONSTRAINT "stay_journeys_guest_stay_id_fkey" FOREIGN KEY ("guest_stay_id") REFERENCES "guest_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_segments" ADD CONSTRAINT "stay_segments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "stay_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_segments" ADD CONSTRAINT "stay_segments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_segments" ADD CONSTRAINT "stay_segments_guest_stay_id_fkey" FOREIGN KEY ("guest_stay_id") REFERENCES "guest_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_nights" ADD CONSTRAINT "segment_nights_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "stay_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_journey_events" ADD CONSTRAINT "stay_journey_events_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "stay_journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

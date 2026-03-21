-- CreateEnum
CREATE TYPE "DiscrepancyType" AS ENUM ('BED_STATUS_MISMATCH', 'GUEST_EXTENSION', 'UNEXPECTED_OCCUPANCY', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "PropertySettings" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "defaultCheckoutTime" TEXT NOT NULL DEFAULT '11:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "pmsMode" TEXT NOT NULL DEFAULT 'STANDALONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedDiscrepancy" (
    "id" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "type" "DiscrepancyType" NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BedDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertySettings_propertyId_key" ON "PropertySettings"("propertyId");

-- CreateIndex
CREATE INDEX "BedDiscrepancy_bedId_idx" ON "BedDiscrepancy"("bedId");

-- CreateIndex
CREATE INDEX "BedDiscrepancy_status_idx" ON "BedDiscrepancy"("status");

-- AddForeignKey
ALTER TABLE "PropertySettings" ADD CONSTRAINT "PropertySettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedDiscrepancy" ADD CONSTRAINT "BedDiscrepancy_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedDiscrepancy" ADD CONSTRAINT "BedDiscrepancy_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "HousekeepingStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedDiscrepancy" ADD CONSTRAINT "BedDiscrepancy_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "HousekeepingStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

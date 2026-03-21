-- DropForeignKey
ALTER TABLE "TaskLog" DROP CONSTRAINT "TaskLog_staffId_fkey";

-- AlterTable
ALTER TABLE "TaskLog" ALTER COLUMN "staffId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "HousekeepingStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

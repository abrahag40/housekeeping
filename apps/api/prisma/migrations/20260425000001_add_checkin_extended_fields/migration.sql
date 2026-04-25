-- CreateEnum
CREATE TYPE "key_delivery_type" AS ENUM ('PHYSICAL', 'CARD', 'CODE', 'MOBILE');

-- AlterTable
ALTER TABLE "guest_stays" ADD COLUMN "arrival_notes" TEXT;
ALTER TABLE "guest_stays" ADD COLUMN "key_type" "key_delivery_type";

-- AlterTable
ALTER TABLE "guest_stays" ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_payment_intent_id" TEXT,
ADD COLUMN     "stripe_payment_method_id" TEXT;

-- AlterTable
ALTER TABLE "property_settings" ADD COLUMN     "channex_property_id" TEXT;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "channex_room_type_id" TEXT;

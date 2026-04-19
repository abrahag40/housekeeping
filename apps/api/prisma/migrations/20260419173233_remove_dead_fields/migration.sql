-- Remove dead audit fields: createdById / updatedById
-- These columns were defined in the schema but never written or read by any service.
-- Verified: zero references in apps/api/src, apps/web/src, packages/shared/src.

ALTER TABLE "checkouts" DROP COLUMN IF EXISTS "created_by_id";

ALTER TABLE "cleaning_tasks" DROP COLUMN IF EXISTS "created_by_id";
ALTER TABLE "cleaning_tasks" DROP COLUMN IF EXISTS "updated_by_id";

ALTER TABLE "maintenance_issues" DROP COLUMN IF EXISTS "created_by_id";

-- bed_discrepancies was renamed to unit_discrepancies in 20260419171711_rename_bed_to_unit.
ALTER TABLE IF EXISTS "bed_discrepancies" DROP COLUMN IF EXISTS "created_by_id";
ALTER TABLE IF EXISTS "unit_discrepancies" DROP COLUMN IF EXISTS "created_by_id";

-- Remove Property.checkinTime / checkoutTime.
-- PropertySettings.defaultCheckoutTime is the canonical field used by all services.
ALTER TABLE "properties" DROP COLUMN IF EXISTS "checkin_time";
ALTER TABLE "properties" DROP COLUMN IF EXISTS "checkout_time";

-- Drop RoomStatusLog: table exists in DB but no service ever writes or reads it.
DROP TABLE IF EXISTS "room_status_logs";

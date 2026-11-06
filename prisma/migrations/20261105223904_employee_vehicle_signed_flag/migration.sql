-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "has_signed_vehicle_responsibility" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: employees whose current vehicle safeguard is already signed.
UPDATE "employees" AS e
SET "has_signed_vehicle_responsibility" = true
WHERE EXISTS (
  SELECT 1
  FROM "vehicle_safeguards" AS vs
  WHERE vs."employee_id" = e."id"
    AND vs."superseded_at" IS NULL
    AND vs."signed_at" IS NOT NULL
);

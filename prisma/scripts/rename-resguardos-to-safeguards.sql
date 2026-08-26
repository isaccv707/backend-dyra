-- Renames the resguardos feature (tables, columns, enum types, constraints,
-- indexes) to English "safeguards" naming. Pure renames only - no data loss.
-- Run this against a given database BEFORE deploying code that expects the
-- new Prisma schema (models Safeguard/SafeguardComputerDetail/etc.).

BEGIN;

-- ============ Tables ============
ALTER TABLE resguardos RENAME TO safeguards;
ALTER TABLE resguardo_computer_details RENAME TO safeguard_computer_details;
ALTER TABLE resguardo_mobile_details RENAME TO safeguard_mobile_details;
ALTER TABLE resguardo_vehicle_details RENAME TO safeguard_vehicle_details;
ALTER TABLE resguardo_accessory_details RENAME TO safeguard_accessory_details;
ALTER TABLE resguardo_vehicle_inspection_items RENAME TO safeguard_vehicle_inspection_items;

-- ============ Columns ============
ALTER TABLE safeguard_computer_details RENAME COLUMN resguardo_id TO safeguard_id;
ALTER TABLE safeguard_mobile_details RENAME COLUMN resguardo_id TO safeguard_id;
ALTER TABLE safeguard_vehicle_details RENAME COLUMN resguardo_id TO safeguard_id;

-- ============ Enum types ============
ALTER TYPE "ResguardoUsageType" RENAME TO "SafeguardUsageType";
ALTER TYPE "ResguardoConditionState" RENAME TO "SafeguardConditionState";
ALTER TYPE "ResguardoVehicleInspectionSection" RENAME TO "SafeguardVehicleInspectionSection";

-- ============ safeguards: constraints & indexes ============
ALTER TABLE safeguards RENAME CONSTRAINT resguardos_pkey TO safeguards_pkey;
ALTER INDEX resguardos_branch_id_idx RENAME TO safeguards_branch_id_idx;
ALTER INDEX resguardos_created_by_user_id_idx RENAME TO safeguards_created_by_user_id_idx;
ALTER INDEX resguardos_employee_id_key RENAME TO safeguards_employee_id_key;
ALTER TABLE safeguards RENAME CONSTRAINT resguardos_branch_id_fkey TO safeguards_branch_id_fkey;
ALTER TABLE safeguards RENAME CONSTRAINT resguardos_created_by_user_id_fkey TO safeguards_created_by_user_id_fkey;
ALTER TABLE safeguards RENAME CONSTRAINT resguardos_employee_id_fkey TO safeguards_employee_id_fkey;

-- ============ safeguard_computer_details ============
ALTER TABLE safeguard_computer_details RENAME CONSTRAINT resguardo_computer_details_pkey TO safeguard_computer_details_pkey;
ALTER INDEX resguardo_computer_details_device_id_idx RENAME TO safeguard_computer_details_device_id_idx;
ALTER INDEX resguardo_computer_details_resguardo_id_key RENAME TO safeguard_computer_details_safeguard_id_key;
ALTER TABLE safeguard_computer_details RENAME CONSTRAINT resguardo_computer_details_device_id_fkey TO safeguard_computer_details_device_id_fkey;
ALTER TABLE safeguard_computer_details RENAME CONSTRAINT resguardo_computer_details_resguardo_id_fkey TO safeguard_computer_details_safeguard_id_fkey;

-- ============ safeguard_mobile_details ============
ALTER TABLE safeguard_mobile_details RENAME CONSTRAINT resguardo_mobile_details_pkey TO safeguard_mobile_details_pkey;
ALTER INDEX resguardo_mobile_details_device_id_idx RENAME TO safeguard_mobile_details_device_id_idx;
ALTER INDEX resguardo_mobile_details_resguardo_id_key RENAME TO safeguard_mobile_details_safeguard_id_key;
ALTER TABLE safeguard_mobile_details RENAME CONSTRAINT resguardo_mobile_details_device_id_fkey TO safeguard_mobile_details_device_id_fkey;
ALTER TABLE safeguard_mobile_details RENAME CONSTRAINT resguardo_mobile_details_resguardo_id_fkey TO safeguard_mobile_details_safeguard_id_fkey;

-- ============ safeguard_vehicle_details ============
ALTER TABLE safeguard_vehicle_details RENAME CONSTRAINT resguardo_vehicle_details_pkey TO safeguard_vehicle_details_pkey;
ALTER INDEX resguardo_vehicle_details_device_id_idx RENAME TO safeguard_vehicle_details_device_id_idx;
ALTER INDEX resguardo_vehicle_details_resguardo_id_key RENAME TO safeguard_vehicle_details_safeguard_id_key;
ALTER TABLE safeguard_vehicle_details RENAME CONSTRAINT resguardo_vehicle_details_device_id_fkey TO safeguard_vehicle_details_device_id_fkey;
ALTER TABLE safeguard_vehicle_details RENAME CONSTRAINT resguardo_vehicle_details_resguardo_id_fkey TO safeguard_vehicle_details_safeguard_id_fkey;

-- ============ safeguard_accessory_details ============
ALTER TABLE safeguard_accessory_details RENAME CONSTRAINT resguardo_accessory_details_pkey TO safeguard_accessory_details_pkey;
ALTER INDEX resguardo_accessory_details_computer_detail_id_idx RENAME TO safeguard_accessory_details_computer_detail_id_idx;
ALTER INDEX resguardo_accessory_details_device_id_idx RENAME TO safeguard_accessory_details_device_id_idx;
ALTER INDEX resguardo_accessory_details_mobile_detail_id_idx RENAME TO safeguard_accessory_details_mobile_detail_id_idx;
ALTER TABLE safeguard_accessory_details RENAME CONSTRAINT resguardo_accessory_details_computer_detail_id_fkey TO safeguard_accessory_details_computer_detail_id_fkey;
ALTER TABLE safeguard_accessory_details RENAME CONSTRAINT resguardo_accessory_details_device_id_fkey TO safeguard_accessory_details_device_id_fkey;
ALTER TABLE safeguard_accessory_details RENAME CONSTRAINT resguardo_accessory_details_mobile_detail_id_fkey TO safeguard_accessory_details_mobile_detail_id_fkey;

-- ============ safeguard_vehicle_inspection_items ============
ALTER TABLE safeguard_vehicle_inspection_items RENAME CONSTRAINT resguardo_vehicle_inspection_items_pkey TO safeguard_vehicle_inspection_items_pkey;
ALTER TABLE safeguard_vehicle_inspection_items RENAME CONSTRAINT resguardo_vehicle_inspection_items_vehicle_detail_id_fkey TO safeguard_vehicle_inspection_items_vehicle_detail_id_fkey;
-- NOTE: the composite unique index name is left as-is here; Postgres'
-- 63-byte identifier limit truncates the fully-renamed form differently
-- than a naive rename, so `npx prisma db push` is used afterwards to let
-- Prisma reconcile that single index name to its exact expected form
-- (a harmless drop+recreate of a UNIQUE index, not a data change).

COMMIT;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('HOME');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('COMPUTER', 'MONITOR', 'KEYBOARD', 'MOUSE', 'MOBILE');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('INTERNAL', 'PROVIDER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_TRANSFER', 'MAINTENANCE', 'RETIRED_DISPOSED', 'LOST');

-- CreateEnum
CREATE TYPE "SafeguardUsageType" AS ENUM ('TEMPORARY', 'PERMANENT');

-- CreateEnum
CREATE TYPE "SafeguardConditionState" AS ENUM ('NEW', 'SEMINUEVO');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY_PURCHASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ASSIGNMENT', 'UNASSIGNMENT', 'UNLINK', 'MAINTENANCE', 'DISPOSAL');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('PARAGRAPH', 'LIST', 'SUBTITLE', 'QUOTE', 'IMAGE');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('HARDWARE', 'SOFTWARE', 'NETWORK', 'ACCESS', 'COGNITI', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'CATEGORY_CHANGED', 'SUBCATEGORY_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'COMMENTED', 'REOPENED');

-- CreateEnum
CREATE TYPE "SafeguardVehicleInspectionSection" AS ENUM ('DOCUMENTS', 'BODY');

-- CreateTable
CREATE TABLE "authors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "avatar" TEXT,
    "bio" TEXT,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "placement" "BannerPlacement" NOT NULL DEFAULT 'HOME',
    "image_url" TEXT NOT NULL,
    "mobile_image_url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN DEFAULT true,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" SERIAL NOT NULL,
    "zip_code" TEXT NOT NULL,
    "ext_number" TEXT NOT NULL,
    "int_number" TEXT,
    "references" TEXT,
    "street" TEXT NOT NULL,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "urlResults" TEXT NOT NULL,
    "state_id" INTEGER NOT NULL,
    "address_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_schedules" (
    "id" TEXT NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "open_time" TEXT,
    "close_time" TEXT,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "branch_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_catalogs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_items" (
    "id" TEXT NOT NULL,
    "internal_code" TEXT NOT NULL,
    "serial_number" TEXT,
    "ownership_type" "OwnershipType" NOT NULL DEFAULT 'INTERNAL',
    "provider_folio" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "SafeguardConditionState" NOT NULL,
    "notes" TEXT,
    "hard_drive" TEXT,
    "processor" TEXT,
    "imei" TEXT,
    "phone_number" TEXT,
    "catalog_id" TEXT NOT NULL,
    "current_branch_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "location_id" TEXT,
    "main_device_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_requests" (
    "id" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "origin_branch_id" TEXT NOT NULL,
    "destination_branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_request_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_movement_history" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "details" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "origin_branch_id" TEXT,
    "destination_branch_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_movement_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "department" TEXT NOT NULL,
    "has_signed_responsibility" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "image" TEXT,
    "imageMobile" TEXT,
    "readingTime" INTEGER,
    "metaDescription" TEXT,
    "tags" TEXT[],
    "category" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "id" TEXT NOT NULL,
    "type" "BlockType" NOT NULL,
    "order" INTEGER NOT NULL,
    "content" TEXT,
    "src" TEXT,
    "alt" TEXT,
    "postId" TEXT NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_sheets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "price_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_on_price_list" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "studyId" TEXT NOT NULL,
    "priceSheetId" TEXT NOT NULL,

    CONSTRAINT "study_on_price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "client_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_name" TEXT,
    "phone_number" TEXT NOT NULL,
    "email" TEXT,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "tax" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "branchId" TEXT NOT NULL,
    "priceSheetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "components" JSONB,
    "studyId" TEXT,
    "quotationId" TEXT NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safeguards" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "position" TEXT,
    "area" TEXT NOT NULL,
    "usage_type" "SafeguardUsageType" NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "signed_by_user_id" TEXT,
    "signed_document_public_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safeguards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safeguard_computer_details" (
    "id" TEXT NOT NULL,
    "safeguard_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serial_number" TEXT,
    "internal_code" TEXT,
    "hard_drive" TEXT,
    "processor" TEXT,
    "condition" "SafeguardConditionState" NOT NULL,
    "observations" TEXT,

    CONSTRAINT "safeguard_computer_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safeguard_mobile_details" (
    "id" TEXT NOT NULL,
    "safeguard_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serial_number" TEXT,
    "internal_code" TEXT,
    "imei" TEXT,
    "phone_number" TEXT,
    "condition" "SafeguardConditionState" NOT NULL,
    "observations" TEXT,

    CONSTRAINT "safeguard_mobile_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safeguard_accessory_details" (
    "id" TEXT NOT NULL,
    "computer_detail_id" TEXT,
    "mobile_detail_id" TEXT,
    "device_id" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "internal_code" TEXT,

    CONSTRAINT "safeguard_accessory_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "image_url" TEXT NOT NULL,
    "mobile_image_url" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "price_sheet_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_details" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "imageMobile" TEXT,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "service_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefits" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sampleType" TEXT,
    "deliveryTime" INTEGER,
    "preparation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "abbreviation" TEXT,
    "section" TEXT NOT NULL DEFAULT 'General',
    "technique" TEXT,
    "isPanel" BOOLEAN NOT NULL DEFAULT false,
    "units" TEXT,
    "decimals" INTEGER,
    "gender" TEXT NOT NULL DEFAULT 'A',
    "ageFormat" TEXT NOT NULL DEFAULT 'AÑOS',
    "minAge" INTEGER NOT NULL DEFAULT 0,
    "maxAge" INTEGER NOT NULL DEFAULT 120,
    "branch_id" TEXT NOT NULL,
    "section_id" INTEGER,
    "sample_type_id" INTEGER,
    "technique_id" INTEGER,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_panel_items" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "panel_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,

    CONSTRAINT "study_panel_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_reference_values" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "study_id" TEXT NOT NULL,
    "gender" TEXT,
    "unit_age" TEXT,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "min_value" DECIMAL(18,6),
    "max_value" DECIMAL(18,6),
    "text" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sections" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sample_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_techniques" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_techniques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_subcategories" (
    "id" TEXT NOT NULL,
    "category" "Category" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "type" "TicketEventType" NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "code" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "category" "Category" NOT NULL,
    "subcategory_id" TEXT,
    "branch_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "first_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "reopened_count" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "overdue_notified_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_assignees" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_notifications" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "ticket_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_safeguards" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "position" TEXT,
    "area" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mileage" TEXT,
    "plate_number" TEXT,
    "fuel_type" TEXT,
    "transmission" TEXT,
    "condition" "SafeguardConditionState" NOT NULL,
    "usage_type" "SafeguardUsageType" NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "signed_by_user_id" TEXT,
    "signed_document_public_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_safeguards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_safeguard_inspection_items" (
    "id" TEXT NOT NULL,
    "vehicle_safeguard_id" TEXT NOT NULL,
    "section" "SafeguardVehicleInspectionSection" NOT NULL,
    "item_key" TEXT NOT NULL,
    "state" TEXT,
    "observations" TEXT,

    CONSTRAINT "vehicle_safeguard_inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_catalogs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_items" (
    "id" TEXT NOT NULL,
    "internal_code" TEXT NOT NULL,
    "plate_number" TEXT,
    "mileage" TEXT,
    "fuel_type" TEXT,
    "transmission" TEXT,
    "ownership_type" "OwnershipType" NOT NULL DEFAULT 'INTERNAL',
    "provider_folio" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "SafeguardConditionState" NOT NULL,
    "notes" TEXT,
    "catalog_id" TEXT NOT NULL,
    "current_branch_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "location_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_transfer_requests" (
    "id" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "origin_branch_id" TEXT NOT NULL,
    "destination_branch_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_transfer_items" (
    "id" TEXT NOT NULL,
    "transfer_request_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_movement_history" (
    "id" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "details" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "origin_branch_id" TEXT,
    "destination_branch_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_movement_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BranchToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BranchToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PermissionToRole_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "authors_branch_id_idx" ON "authors"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "authors_branch_id_name_key" ON "authors"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "authors_branch_id_nameKey_key" ON "authors"("branch_id", "nameKey");

-- CreateIndex
CREATE INDEX "banners_branch_id_placement_isActive_order_idx" ON "banners"("branch_id", "placement", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "branches_address_id_key" ON "branches"("address_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_schedules_branch_id_day_of_week_key" ON "branch_schedules"("branch_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "device_items_internal_code_key" ON "device_items"("internal_code");

-- CreateIndex
CREATE UNIQUE INDEX "device_items_serial_number_key" ON "device_items"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "device_items_imei_key" ON "device_items"("imei");

-- CreateIndex
CREATE INDEX "device_items_catalog_id_idx" ON "device_items"("catalog_id");

-- CreateIndex
CREATE INDEX "device_items_current_branch_id_idx" ON "device_items"("current_branch_id");

-- CreateIndex
CREATE INDEX "device_items_employee_id_idx" ON "device_items"("employee_id");

-- CreateIndex
CREATE INDEX "device_items_location_id_idx" ON "device_items"("location_id");

-- CreateIndex
CREATE INDEX "device_items_main_device_id_idx" ON "device_items"("main_device_id");

-- CreateIndex
CREATE INDEX "transfer_requests_origin_branch_id_idx" ON "transfer_requests"("origin_branch_id");

-- CreateIndex
CREATE INDEX "transfer_requests_destination_branch_id_idx" ON "transfer_requests"("destination_branch_id");

-- CreateIndex
CREATE INDEX "transfer_requests_status_idx" ON "transfer_requests"("status");

-- CreateIndex
CREATE INDEX "transfer_items_device_id_idx" ON "transfer_items"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_items_transfer_request_id_device_id_key" ON "transfer_items"("transfer_request_id", "device_id");

-- CreateIndex
CREATE INDEX "device_movement_history_device_id_idx" ON "device_movement_history"("device_id");

-- CreateIndex
CREATE INDEX "device_movement_history_origin_branch_id_idx" ON "device_movement_history"("origin_branch_id");

-- CreateIndex
CREATE INDEX "device_movement_history_destination_branch_id_idx" ON "device_movement_history"("destination_branch_id");

-- CreateIndex
CREATE INDEX "employees_branch_id_idx" ON "employees"("branch_id");

-- CreateIndex
CREATE INDEX "locations_branch_id_idx" ON "locations"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_branch_id_name_key" ON "locations"("branch_id", "name");

-- CreateIndex
CREATE INDEX "posts_branch_id_idx" ON "posts"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_branch_id_slug_key" ON "posts"("branch_id", "slug");

-- CreateIndex
CREATE INDEX "price_sheets_branch_id_idx" ON "price_sheets"("branch_id");

-- CreateIndex
CREATE INDEX "study_on_price_list_priceSheetId_idx" ON "study_on_price_list"("priceSheetId");

-- CreateIndex
CREATE UNIQUE INDEX "study_on_price_list_studyId_priceSheetId_key" ON "study_on_price_list"("studyId", "priceSheetId");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_folio_key" ON "quotations"("folio");

-- CreateIndex
CREATE INDEX "quotations_branchId_idx" ON "quotations"("branchId");

-- CreateIndex
CREATE INDEX "quotations_priceSheetId_idx" ON "quotations"("priceSheetId");

-- CreateIndex
CREATE INDEX "reviews_branchId_idx" ON "reviews"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_action_key" ON "Permission"("action");

-- CreateIndex
CREATE INDEX "safeguards_branch_id_idx" ON "safeguards"("branch_id");

-- CreateIndex
CREATE INDEX "safeguards_created_by_user_id_idx" ON "safeguards"("created_by_user_id");

-- CreateIndex
CREATE INDEX "safeguards_employee_id_superseded_at_idx" ON "safeguards"("employee_id", "superseded_at");

-- CreateIndex
CREATE UNIQUE INDEX "safeguard_computer_details_safeguard_id_key" ON "safeguard_computer_details"("safeguard_id");

-- CreateIndex
CREATE INDEX "safeguard_computer_details_device_id_idx" ON "safeguard_computer_details"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "safeguard_mobile_details_safeguard_id_key" ON "safeguard_mobile_details"("safeguard_id");

-- CreateIndex
CREATE INDEX "safeguard_mobile_details_device_id_idx" ON "safeguard_mobile_details"("device_id");

-- CreateIndex
CREATE INDEX "safeguard_accessory_details_computer_detail_id_idx" ON "safeguard_accessory_details"("computer_detail_id");

-- CreateIndex
CREATE INDEX "safeguard_accessory_details_mobile_detail_id_idx" ON "safeguard_accessory_details"("mobile_detail_id");

-- CreateIndex
CREATE INDEX "safeguard_accessory_details_device_id_idx" ON "safeguard_accessory_details"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_price_sheet_id_key" ON "services"("price_sheet_id");

-- CreateIndex
CREATE INDEX "services_branch_id_idx" ON "services"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_branch_id_name_key" ON "services"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "services_branch_id_slug_key" ON "services"("branch_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "states_name_key" ON "states"("name");

-- CreateIndex
CREATE INDEX "studies_branch_id_idx" ON "studies"("branch_id");

-- CreateIndex
CREATE INDEX "studies_section_id_idx" ON "studies"("section_id");

-- CreateIndex
CREATE INDEX "studies_sample_type_id_idx" ON "studies"("sample_type_id");

-- CreateIndex
CREATE INDEX "studies_technique_id_idx" ON "studies"("technique_id");

-- CreateIndex
CREATE UNIQUE INDEX "studies_branch_id_code_key" ON "studies"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "studies_branch_id_slug_key" ON "studies"("branch_id", "slug");

-- CreateIndex
CREATE INDEX "study_panel_items_child_id_idx" ON "study_panel_items"("child_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_panel_items_panel_id_child_id_key" ON "study_panel_items"("panel_id", "child_id");

-- CreateIndex
CREATE INDEX "study_reference_values_study_id_idx" ON "study_reference_values"("study_id");

-- CreateIndex
CREATE INDEX "study_sections_branch_id_idx" ON "study_sections"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_sections_branch_id_name_key" ON "study_sections"("branch_id", "name");

-- CreateIndex
CREATE INDEX "sample_types_branch_id_idx" ON "sample_types"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sample_types_branch_id_name_key" ON "sample_types"("branch_id", "name");

-- CreateIndex
CREATE INDEX "study_techniques_branch_id_idx" ON "study_techniques"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "study_techniques_branch_id_name_key" ON "study_techniques"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_subcategories_category_name_key" ON "ticket_subcategories"("category", "name");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_createdAt_idx" ON "ticket_events"("ticket_id", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_events_type_createdAt_idx" ON "ticket_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_events_actor_id_idx" ON "ticket_events"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_code_key" ON "tickets"("code");

-- CreateIndex
CREATE INDEX "tickets_branch_id_idx" ON "tickets"("branch_id");

-- CreateIndex
CREATE INDEX "tickets_created_by_id_idx" ON "tickets"("created_by_id");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_subcategory_id_idx" ON "tickets"("subcategory_id");

-- CreateIndex
CREATE INDEX "tickets_branch_id_createdAt_idx" ON "tickets"("branch_id", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_created_by_id_createdAt_idx" ON "tickets"("created_by_id", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_category_createdAt_idx" ON "tickets"("category", "createdAt");

-- CreateIndex
CREATE INDEX "tickets_resolved_at_idx" ON "tickets"("resolved_at");

-- CreateIndex
CREATE INDEX "tickets_due_at_idx" ON "tickets"("due_at");

-- CreateIndex
CREATE INDEX "ticket_assignees_user_id_idx" ON "ticket_assignees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignees_ticket_id_user_id_key" ON "ticket_assignees"("ticket_id", "user_id");

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_idx" ON "ticket_comments"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_comments_author_id_idx" ON "ticket_comments"("author_id");

-- CreateIndex
CREATE INDEX "ticket_notifications_user_id_read_idx" ON "ticket_notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "ticket_notifications_ticket_id_idx" ON "ticket_notifications"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "vehicle_safeguards_branch_id_idx" ON "vehicle_safeguards"("branch_id");

-- CreateIndex
CREATE INDEX "vehicle_safeguards_vehicle_id_idx" ON "vehicle_safeguards"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_safeguards_employee_id_superseded_at_idx" ON "vehicle_safeguards"("employee_id", "superseded_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_safeguard_inspection_items_vehicle_safeguard_id_ite_key" ON "vehicle_safeguard_inspection_items"("vehicle_safeguard_id", "item_key");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_items_internal_code_key" ON "vehicle_items"("internal_code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_items_plate_number_key" ON "vehicle_items"("plate_number");

-- CreateIndex
CREATE INDEX "vehicle_items_catalog_id_idx" ON "vehicle_items"("catalog_id");

-- CreateIndex
CREATE INDEX "vehicle_items_current_branch_id_idx" ON "vehicle_items"("current_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_items_employee_id_idx" ON "vehicle_items"("employee_id");

-- CreateIndex
CREATE INDEX "vehicle_items_location_id_idx" ON "vehicle_items"("location_id");

-- CreateIndex
CREATE INDEX "vehicle_transfer_requests_origin_branch_id_idx" ON "vehicle_transfer_requests"("origin_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_transfer_requests_destination_branch_id_idx" ON "vehicle_transfer_requests"("destination_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_transfer_requests_status_idx" ON "vehicle_transfer_requests"("status");

-- CreateIndex
CREATE INDEX "vehicle_transfer_items_vehicle_id_idx" ON "vehicle_transfer_items"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_transfer_items_transfer_request_id_vehicle_id_key" ON "vehicle_transfer_items"("transfer_request_id", "vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_movement_history_vehicle_id_idx" ON "vehicle_movement_history"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_movement_history_origin_branch_id_idx" ON "vehicle_movement_history"("origin_branch_id");

-- CreateIndex
CREATE INDEX "vehicle_movement_history_destination_branch_id_idx" ON "vehicle_movement_history"("destination_branch_id");

-- CreateIndex
CREATE INDEX "_BranchToUser_B_index" ON "_BranchToUser"("B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");

-- AddForeignKey
ALTER TABLE "authors" ADD CONSTRAINT "authors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_schedules" ADD CONSTRAINT "branch_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_items" ADD CONSTRAINT "device_items_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "device_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_items" ADD CONSTRAINT "device_items_current_branch_id_fkey" FOREIGN KEY ("current_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_items" ADD CONSTRAINT "device_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_items" ADD CONSTRAINT "device_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_items" ADD CONSTRAINT "device_items_main_device_id_fkey" FOREIGN KEY ("main_device_id") REFERENCES "device_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_origin_branch_id_fkey" FOREIGN KEY ("origin_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_requests" ADD CONSTRAINT "transfer_requests_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "transfer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movement_history" ADD CONSTRAINT "device_movement_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movement_history" ADD CONSTRAINT "device_movement_history_origin_branch_id_fkey" FOREIGN KEY ("origin_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movement_history" ADD CONSTRAINT "device_movement_history_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_sheets" ADD CONSTRAINT "price_sheets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_on_price_list" ADD CONSTRAINT "study_on_price_list_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_on_price_list" ADD CONSTRAINT "study_on_price_list_priceSheetId_fkey" FOREIGN KEY ("priceSheetId") REFERENCES "price_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_priceSheetId_fkey" FOREIGN KEY ("priceSheetId") REFERENCES "price_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "studies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguards" ADD CONSTRAINT "safeguards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguards" ADD CONSTRAINT "safeguards_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguards" ADD CONSTRAINT "safeguards_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguards" ADD CONSTRAINT "safeguards_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_computer_details" ADD CONSTRAINT "safeguard_computer_details_safeguard_id_fkey" FOREIGN KEY ("safeguard_id") REFERENCES "safeguards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_computer_details" ADD CONSTRAINT "safeguard_computer_details_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_mobile_details" ADD CONSTRAINT "safeguard_mobile_details_safeguard_id_fkey" FOREIGN KEY ("safeguard_id") REFERENCES "safeguards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_mobile_details" ADD CONSTRAINT "safeguard_mobile_details_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_accessory_details" ADD CONSTRAINT "safeguard_accessory_details_computer_detail_id_fkey" FOREIGN KEY ("computer_detail_id") REFERENCES "safeguard_computer_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_accessory_details" ADD CONSTRAINT "safeguard_accessory_details_mobile_detail_id_fkey" FOREIGN KEY ("mobile_detail_id") REFERENCES "safeguard_mobile_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safeguard_accessory_details" ADD CONSTRAINT "safeguard_accessory_details_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_price_sheet_id_fkey" FOREIGN KEY ("price_sheet_id") REFERENCES "price_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_details" ADD CONSTRAINT "service_details_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "study_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_sample_type_id_fkey" FOREIGN KEY ("sample_type_id") REFERENCES "sample_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_technique_id_fkey" FOREIGN KEY ("technique_id") REFERENCES "study_techniques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_panel_items" ADD CONSTRAINT "study_panel_items_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_panel_items" ADD CONSTRAINT "study_panel_items_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_reference_values" ADD CONSTRAINT "study_reference_values_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sections" ADD CONSTRAINT "study_sections_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_types" ADD CONSTRAINT "sample_types_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_techniques" ADD CONSTRAINT "study_techniques_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "ticket_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_notifications" ADD CONSTRAINT "ticket_notifications_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_notifications" ADD CONSTRAINT "ticket_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguards" ADD CONSTRAINT "vehicle_safeguards_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguards" ADD CONSTRAINT "vehicle_safeguards_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguards" ADD CONSTRAINT "vehicle_safeguards_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguards" ADD CONSTRAINT "vehicle_safeguards_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguards" ADD CONSTRAINT "vehicle_safeguards_signed_by_user_id_fkey" FOREIGN KEY ("signed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_safeguard_inspection_items" ADD CONSTRAINT "vehicle_safeguard_inspection_items_vehicle_safeguard_id_fkey" FOREIGN KEY ("vehicle_safeguard_id") REFERENCES "vehicle_safeguards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_items" ADD CONSTRAINT "vehicle_items_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "vehicle_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_items" ADD CONSTRAINT "vehicle_items_current_branch_id_fkey" FOREIGN KEY ("current_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_items" ADD CONSTRAINT "vehicle_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_items" ADD CONSTRAINT "vehicle_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_transfer_requests" ADD CONSTRAINT "vehicle_transfer_requests_origin_branch_id_fkey" FOREIGN KEY ("origin_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_transfer_requests" ADD CONSTRAINT "vehicle_transfer_requests_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_transfer_items" ADD CONSTRAINT "vehicle_transfer_items_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "vehicle_transfer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_transfer_items" ADD CONSTRAINT "vehicle_transfer_items_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_movement_history" ADD CONSTRAINT "vehicle_movement_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_movement_history" ADD CONSTRAINT "vehicle_movement_history_origin_branch_id_fkey" FOREIGN KEY ("origin_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_movement_history" ADD CONSTRAINT "vehicle_movement_history_destination_branch_id_fkey" FOREIGN KEY ("destination_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToUser" ADD CONSTRAINT "_BranchToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BranchToUser" ADD CONSTRAINT "_BranchToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PermissionToRole" ADD CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

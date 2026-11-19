-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('VALID', 'FLAGGED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceFlag" AS ENUM ('OUTSIDE_GEOFENCE', 'LOW_ACCURACY', 'CLOCK_SKEW');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "geofence_radius_m" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "type" "AttendanceType" NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'VALID',
    "source" "AttendanceSource" NOT NULL DEFAULT 'DEVICE',
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_timestamp" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy_m" DOUBLE PRECISION,
    "distance_m" DOUBLE PRECISION,
    "within_geofence" BOOLEAN,
    "flags" "AttendanceFlag"[] DEFAULT ARRAY[]::"AttendanceFlag"[],
    "ip_address" TEXT,
    "user_agent" TEXT,
    "notes" TEXT,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "adjusted_by_id" TEXT,
    "adjusted_at" TIMESTAMP(3),
    "adjustment_reason" TEXT,
    "original_recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_records_user_id_recorded_at_idx" ON "attendance_records"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "attendance_records_branch_id_recorded_at_idx" ON "attendance_records"("branch_id", "recorded_at");

-- CreateIndex
CREATE INDEX "attendance_records_status_idx" ON "attendance_records"("status");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_adjusted_by_id_fkey" FOREIGN KEY ("adjusted_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

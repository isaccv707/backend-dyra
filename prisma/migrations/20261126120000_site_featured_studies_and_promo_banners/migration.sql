-- AlterEnum
ALTER TYPE "BannerPlacement" ADD VALUE IF NOT EXISTS 'PROMO';

-- AlterTable
ALTER TABLE "banners"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "alt_text" TEXT,
  ADD COLUMN IF NOT EXISTS "link_url" TEXT,
  ADD COLUMN IF NOT EXISTS "cta_label" TEXT,
  ADD COLUMN IF NOT EXISTS "promo_price" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "regular_price" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "studies" ADD COLUMN IF NOT EXISTS "featured_order" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "studies_branch_id_featured_order_idx" ON "studies"("branch_id", "featured_order");

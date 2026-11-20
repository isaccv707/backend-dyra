-- CreateTable
CREATE TABLE "branch_internet_providers" (
    "id" TEXT NOT NULL,
    "name_provider" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "monthly_price" DECIMAL(10,2) NOT NULL,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_internet_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_internet_providers_branch_id_key" ON "branch_internet_providers"("branch_id");

-- AddForeignKey
ALTER TABLE "branch_internet_providers" ADD CONSTRAINT "branch_internet_providers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

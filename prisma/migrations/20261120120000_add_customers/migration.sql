-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accounts_receivable" BOOLEAN NOT NULL DEFAULT false,
    "liquidate" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "contract_amount" DECIMAL(12,2),
    "patient_amount" DECIMAL(12,2),
    "start_date" DATE,
    "end_date" DATE,
    "price_sheet_id" TEXT,
    "branch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_branch_id_idx" ON "customers"("branch_id");

-- CreateIndex
CREATE INDEX "customers_price_sheet_id_idx" ON "customers"("price_sheet_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_branch_id_name_key" ON "customers"("branch_id", "name");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_sheet_id_fkey" FOREIGN KEY ("price_sheet_id") REFERENCES "price_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Payment mode: exactly one of accounts receivable (credit) or liquidate (pays at once)
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_mode_check" CHECK ("accounts_receivable" <> "liquidate");

-- Contract period and amounts
ALTER TABLE "customers" ADD CONSTRAINT "customers_dates_check" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "customers" ADD CONSTRAINT "customers_amounts_check" CHECK (("contract_amount" IS NULL OR "contract_amount" >= 0) AND ("patient_amount" IS NULL OR "patient_amount" >= 0));

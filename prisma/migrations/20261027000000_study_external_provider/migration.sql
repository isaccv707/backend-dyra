-- Studies sent to an external lab (maquilador). Existing rows stay internal.
ALTER TABLE "studies" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "providerName" TEXT,
ADD COLUMN "providerCost" DECIMAL(10,2);

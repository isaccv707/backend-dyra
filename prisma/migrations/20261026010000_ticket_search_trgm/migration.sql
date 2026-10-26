-- Trigram search on tickets (ILIKE on title/description). Prisma does not
-- manage the extension: it is created here and ignored by schema diffs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "tickets_title_trgm_idx" ON "tickets" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "tickets_description_trgm_idx" ON "tickets" USING GIN ("description" gin_trgm_ops);

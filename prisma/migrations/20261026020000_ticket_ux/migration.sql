-- CreateTable
CREATE TABLE "ticket_email_preferences" (
    "user_id" TEXT NOT NULL,
    "muted_events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_email_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ticket_reply_templates" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reply_templates_branch_id_title_key" ON "ticket_reply_templates"("branch_id", "title");

-- AddForeignKey
ALTER TABLE "ticket_email_preferences" ADD CONSTRAINT "ticket_email_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reply_templates" ADD CONSTRAINT "ticket_reply_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


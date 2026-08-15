-- AlterEnum
ALTER TYPE "DigestFrequency" ADD VALUE 'realtime';

-- CreateTable
CREATE TABLE "notification_category_preferences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_category_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_category_preferences_organization_id_category_key" ON "notification_category_preferences"("organization_id", "category");

-- AddForeignKey
ALTER TABLE "notification_category_preferences" ADD CONSTRAINT "notification_category_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

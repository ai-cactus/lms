-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pause_starts_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscriptions_pause_starts_at_idx" ON "subscriptions"("pause_starts_at");

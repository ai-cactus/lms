-- CreateEnum
CREATE TYPE "NotificationTier" AS ENUM ('instant', 'digest');

-- CreateEnum
CREATE TYPE "NotificationEventStatus" AS ENUM ('pending', 'dispatched', 'skipped');

-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('daily', 'weekly');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "notification_digest_frequency" "DigestFrequency" NOT NULL DEFAULT 'daily';

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "facility_id" TEXT,
    "tier" "NotificationTier" NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "subject_user_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "NotificationEventStatus" NOT NULL DEFAULT 'pending',
    "dedupe_key" TEXT,
    "digest_run_id" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_digest_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_digest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_events_organization_id_status_created_at_idx" ON "notification_events"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_organization_id_dedupe_key_created_at_idx" ON "notification_events"("organization_id", "dedupe_key", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_digest_runs_organization_id_period_key_key" ON "notification_digest_runs"("organization_id", "period_key");

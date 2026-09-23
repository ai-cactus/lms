-- ─────────────────────────────────────────────────────────────────────────────
-- Unified cycle summary — PR 1 (foundation only).
--
-- Replaces three outbound email streams (reminder ladder, reminder nudges,
-- notification digest) with ONE email per recipient per day. This migration
-- lands the schema only: nothing in the application reads or writes these
-- columns yet, so applying it is a no-op behaviourally. PR 2 flips the traffic
-- over behind CYCLE_SUMMARY_ENABLED.
--
-- HAND-AUTHORED. Two edits were made to what `migrate diff` generated — re-check
-- for both on every future migration:
--
--   1. The generator emitted `DROP TABLE "notification_digest_runs";` plus a
--      fresh `CREATE TABLE "cycle_summary_runs"`. Schema→schema diffing has no
--      rename detection, and applying that pair would DESTROY every claim row —
--      which would let an organization already summarized this period be
--      summarized (and emailed) a second time. Replaced with ALTER TABLE …
--      RENAME TO, plus renames of the primary key and the unique index so the
--      DB object names match what Prisma expects.
--
--   2. `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — not emitted by this
--      schema→schema diff, but `migrate dev` always adds it because the pgvector
--      HNSW index is raw-SQL-managed and unmodellable. Applying it would
--      silently destroy RAG query performance. Verified absent here.
-- ─────────────────────────────────────────────────────────────────────────────

-- RenameTable — pure rename, data preserved (see note 1 above).
ALTER TABLE "notification_digest_runs" RENAME TO "cycle_summary_runs";

-- RenameIndex
ALTER TABLE "cycle_summary_runs" RENAME CONSTRAINT "notification_digest_runs_pkey" TO "cycle_summary_runs_pkey";
ALTER INDEX "notification_digest_runs_organization_id_period_key_key" RENAME TO "cycle_summary_runs_organization_id_period_key_key";

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "organization_id" TEXT,
ADD COLUMN     "to_name" TEXT;

-- AlterTable
ALTER TABLE "reminder_logs" ADD COLUMN     "summarized_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "reminder_nudges" ADD COLUMN     "summarized_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cycle_summary_items" (
    "id" TEXT NOT NULL,
    "email_message_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_summary_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cycle_summary_items_email_message_id_idx" ON "cycle_summary_items"("email_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_summary_items_email_message_id_item_type_item_id_key" ON "cycle_summary_items"("email_message_id", "item_type", "item_id");

-- AddForeignKey
ALTER TABLE "cycle_summary_items" ADD CONSTRAINT "cycle_summary_items_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Partial indexes (raw) — the compose pass scans for un-summarized rows only,
-- which is a shrinking minority of two ever-growing tables. Prisma's DSL has no
-- WHERE clause on @@index, so these are hand-maintained here and are invisible
-- to the datamodel. Unlike the HNSW index they do NOT register as drift —
-- verified after applying with `prisma migrate diff --from-config-datasource
-- --to-schema prisma --script`, whose output was unchanged (Prisma's diff
-- engine ignores partial indexes). Re-verify that after any Prisma upgrade; if
-- a DROP for either ever appears, strip it alongside note 2 above.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "reminder_logs_unsummarized_idx" ON "reminder_logs" ("summarized_at") WHERE "summarized_at" IS NULL;

CREATE INDEX IF NOT EXISTS "reminder_nudges_unsummarized_idx" ON "reminder_nudges" ("summarized_at") WHERE "summarized_at" IS NULL;

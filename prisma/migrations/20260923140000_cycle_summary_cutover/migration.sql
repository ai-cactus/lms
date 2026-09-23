-- ─────────────────────────────────────────────────────────────────────────────
-- Unified cycle summary — PR 2 (the flag-gated cutover).
--
-- Two changes, both prerequisites for turning CYCLE_SUMMARY_ENABLED on:
--
--   1. reminder_nudges.attempts_remaining — the WORKER_RETAKE summary line has
--      to say "N attempts remaining", exactly as the standalone nudge email did.
--      The count is derived by the sweep from the latest quiz attempt and was
--      never persisted, so the composer (which runs hours later) had no way to
--      recover it. Nullable: ADMIN_REASSIGN nudges have no such count, and every
--      pre-existing row predates the writer.
--
--   2. A one-time watermark over the summarizable columns. Every reminder row
--      that exists when this migration runs was already delivered as its own
--      per-stage email by the pre-cutover path, so it must never be gathered
--      into a summary. Without this, the first run after the flag flips would
--      sweep up MONTHS of historical rows (summarized_at has been null since PR
--      1 added it) and mail every learner a summary of long-settled reminders.
--      From here on the null-vs-stamped split is maintained by dispatch itself:
--      flag off stamps at claim time, flag on leaves null for the composer.
--
-- HAND-AUTHORED. Re-checked against the two traps documented in the PR 1
-- migration (20260923120000_add_cycle_summary):
--   * no `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the pgvector HNSW
--     index is raw-SQL-managed and `migrate dev` re-emits a DROP for it every
--     time. Verified absent below.
--   * no table rename is involved here, so there is no DROP+CREATE to rewrite.
--   * the PR 1 partial indexes (`reminder_logs_unsummarized_idx`,
--     `reminder_nudges_unsummarized_idx`) are left untouched; the backfill below
--     empties them, which is the intended steady state.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "reminder_nudges" ADD COLUMN     "attempts_remaining" INTEGER;

-- Cutover watermark (see note 2). Idempotent: re-running matches no rows.
UPDATE "reminder_logs" SET "summarized_at" = CURRENT_TIMESTAMP WHERE "summarized_at" IS NULL;

UPDATE "reminder_nudges" SET "summarized_at" = CURRENT_TIMESTAMP WHERE "summarized_at" IS NULL;

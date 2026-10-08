-- ─────────────────────────────────────────────────────────────────────────────
-- enrollments.retry_requested_at — Q-35 (2026-10-07): a learner locked out of a
-- course after using every quiz attempt can ask their admins for a retake. The
-- column records the latest request; it never changes the enrolment's status.
--
-- Nullable with no backfill: no request has ever been recorded, so NULL is the
-- correct value for every existing row. No index — it is only read on rows
-- already selected by id or by learner.
--
-- HAND-AUTHORED and idempotent (IF NOT EXISTS). No
-- `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the pgvector HNSW index is
-- raw-SQL-managed and `migrate dev` re-emits a DROP for it every time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "retry_requested_at" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- enrollments.last_activity_at — when the learner last engaged with the
-- enrolment. Written from here on by learner-initiated events only; admin
-- actions (assigning, admin retakes, sweeps) never touch it.
--
-- The backfill takes the latest known learner timestamp per row:
--   * MAX(quiz_attempts.completed_at) over SUBMITTED attempts only. A row with
--     time_taken IS NULL is an in-progress draft whose completed_at is really
--     the time the quiz was started, so it is excluded.
--   * attested_at, completed_at.
--   * started_at — the enrolment creation (assignment) time. It is NOT NULL,
--     so it is the floor: every row receives a value.
-- GREATEST ignores NULLs. Because every row is stamped on the first run, the
-- `last_activity_at IS NULL` guard makes a re-run a no-op (UPDATE 0).
--
-- HAND-AUTHORED. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the
-- pgvector HNSW index is raw-SQL-managed and `migrate dev` re-emits a DROP for
-- it every time. No index on the new column: it is evaluated in memory.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "enrollments" ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3);

UPDATE "enrollments" e
SET "last_activity_at" = GREATEST(
  (SELECT MAX(qa."completed_at") FROM "quiz_attempts" qa
    WHERE qa."enrollment_id" = e."id" AND qa."time_taken" IS NOT NULL),
  e."attested_at", e."completed_at", e."started_at")
WHERE e."last_activity_at" IS NULL;

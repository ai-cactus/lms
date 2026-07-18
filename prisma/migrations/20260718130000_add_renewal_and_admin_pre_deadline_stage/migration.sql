-- Recurrence re-trigger + admin pre-deadline reminder (Phase 2, Issues #6 & #8).
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY these three
-- changes — the diff engine otherwise tries to drop the raw-SQL-managed
-- `manual_chunks` pgvector column + its HNSW index and the DB-level defaults on
-- `facilities`. Verified byte-for-byte against `prisma migrate diff` (schema→schema).
--
--   * ReminderStage.ADMIN_PRE_DEADLINE_REMINDER — the fixed 7-day pre-deadline
--     stage sent to the assignment's escalation manager (Issue #8 / TC-024).
--   * enrollments.renewed_from — audit link from a renewal enrollment back to the
--     completed enrollment that spawned it (Issue #6 / TC-019); plain string,
--     mirroring the `retake_of` precedent (no FK relation).
--   * enrollments(course_id, status, completed_at) index — backs the renewal
--     re-trigger sweep's bulk scan for terminal enrollments due for renewal.

-- AlterEnum
ALTER TYPE "ReminderStage" ADD VALUE 'ADMIN_PRE_DEADLINE_REMINDER';

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "renewed_from" TEXT;

-- CreateIndex
CREATE INDEX "enrollments_course_id_status_completed_at_idx" ON "enrollments"("course_id", "status", "completed_at");

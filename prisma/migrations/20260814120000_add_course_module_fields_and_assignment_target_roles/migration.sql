-- ─────────────────────────────────────────────────────────────────────────────
-- Course-wizard design alignment, Phase 1 (schema foundations).
--
-- Fully ADDITIVE apart from one redundant index drop. No existing column is
-- altered or removed; `course_assignments.target_role` stays in place as a
-- deprecated read-compatibility column and is backfilled into the new array.
--
--   * course_modules.objective / .completion_deadline_days — per-module
--     learning objective and its own completion window.
--   * course_versions.module_id — which module a source document feeds.
--     NULL = legacy single-document course authored before per-module sources.
--   * course_assignments.target_roles — an assignment may now target several
--     roles at once. Supersedes the single-valued `target_role`.
--
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY these changes —
-- the diff engine otherwise tries to drop the raw-SQL-managed `manual_chunks`
-- HNSW index and the DB-level defaults on `facilities`. Verified against
-- `prisma migrate diff` (datasource→schema) with those two removed.
-- ─────────────────────────────────────────────────────────────────────────────

-- DropIndex
-- Superseded by the plain `course_assignments_organization_id_idx`: role
-- targeting now lives in an array column, which this btree cannot serve.
DROP INDEX "course_assignments_organization_id_target_role_idx";

-- AlterTable
ALTER TABLE "course_modules" ADD COLUMN     "objective" TEXT,
ADD COLUMN     "completion_deadline_days" INTEGER;

-- AlterTable
ALTER TABLE "course_versions" ADD COLUMN     "module_id" TEXT;

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "target_roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];

-- CreateIndex
CREATE INDEX "course_versions_module_id_idx" ON "course_versions"("module_id");

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: carry every existing single-role assignment into the new array so
-- reads can move to `target_roles` alone without a compatibility fallback.
-- `ADD COLUMN ... DEFAULT` already seeded existing rows with '{}', so this
-- touches only rows that actually had a role target.
UPDATE "course_assignments"
SET "target_roles" = ARRAY["target_role"]::"UserRole"[]
WHERE "target_role" IS NOT NULL AND "target_roles" = '{}';

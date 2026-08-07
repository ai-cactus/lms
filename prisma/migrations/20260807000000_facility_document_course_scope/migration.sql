-- ─────────────────────────────────────────────────────────────────────────────
-- Facility scope on enrollments, category on documents, fork lineage on courses.
--
-- Fully ADDITIVE: every new column is nullable and every new FK is ON DELETE
-- SET NULL, so existing rows are untouched and no backfill is required.
--
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY these additions —
-- the diff engine otherwise tries to drop the raw-SQL-managed `manual_chunks`
-- pgvector column and the DB-level defaults on `facilities`.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enrollments carry the learner's facility at enrollment time so facility-scoped
-- dashboards aggregate without walking the (mutable) membership assignments.
ALTER TABLE "enrollments" ADD COLUMN "facility_id" TEXT;

CREATE INDEX "enrollments_facility_id_idx" ON "enrollments"("facility_id");

CREATE INDEX "enrollments_facility_id_status_idx" ON "enrollments"("facility_id", "status");

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Document Hub classification chosen at upload time.
ALTER TABLE "documents" ADD COLUMN "category" TEXT;

CREATE INDEX "documents_category_idx" ON "documents"("category");

-- Fork lineage: a duplicated or adopted-from-catalog course points at its source.
ALTER TABLE "courses" ADD COLUMN "forked_from_course_id" TEXT;

CREATE INDEX "courses_forked_from_course_id_idx" ON "courses"("forked_from_course_id");

ALTER TABLE "courses" ADD CONSTRAINT "courses_forked_from_course_id_fkey"
  FOREIGN KEY ("forked_from_course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

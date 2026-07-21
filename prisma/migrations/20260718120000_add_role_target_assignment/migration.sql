-- Role-based course assignment with live auto-enroll (Phase 2, Issue #4 / TC-016).
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY these three
-- changes — the diff engine otherwise tries to drop the raw-SQL-managed
-- `manual_chunks` pgvector column + its HNSW index and the DB-level defaults on
-- `facilities`. Verified byte-for-byte against `prisma migrate diff` (schema→schema).
--
--   * course_assignments.target_role — null = individual assignment; a UserRole
--     value = every current AND future holder of that role is auto-enrolled.
--   * users.role_assigned_at — the moment a user gained their current role; the
--     deadline window for late role joiners is computed from this date.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role_assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "target_role" "UserRole";

-- CreateIndex
CREATE INDEX "course_assignments_organization_id_target_role_idx" ON "course_assignments"("organization_id", "target_role");

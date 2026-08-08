-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-org membership: User → OrganizationUser / OrganizationUserFacility.
--
-- `User` becomes a pure global identity. Everything org-scoped (role, facility
-- assignments, manager, per-org login history) moves onto `organization_users`,
-- and every tenant-authored artifact repoints its owning FK from `users` to
-- `organization_users`.
--
-- ⚠️ DESTRUCTIVE BY DESIGN (approved — see docs/multi-org-schema-upgrade-plan.md
-- §"Data-loss consequence"). `organization_users` starts EMPTY and there is no
-- backfill: the deployment pipeline runs migrations before any application
-- script, so a backfill cannot be sequenced between "create tables" and
-- "repoint FKs" within a single deploy. Every row in the six repointed tables
-- would therefore hold a NOT NULL FK pointing at nothing, so those tables are
-- truncated here instead.
--
-- Identity rows in `users` SURVIVE — existing accounts keep their login and
-- must be re-attached to an organization (or re-onboard).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — Reset tenant-authored content.
--
-- The listed tables are the roots; CASCADE carries the reset to their
-- dependents, which is the intended blast radius:
--   courses    → course_modules, lessons, course_artifacts, course_versions,
--                quizzes (→ questions, quiz_attempts), org_course_offerings,
--                course_assignments (→ assignment_reminder_stages)
--   documents  → document_versions (→ phi_reports, mapping_evidence,
--                course_versions)
--   enrollments→ quiz_attempts, certificates, reminder_logs, reminder_nudges
--   invites    → invite_course_assignments
-- ─────────────────────────────────────────────────────────────────────────────
TRUNCATE TABLE
  "invites",
  "notifications",
  "notification_preferences",
  "certificates",
  "enrollments",
  "documents",
  "courses"
CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — `admin` re-enters the role enum as a real, full-access org
-- administrator (Owner-equivalent CRUD incl. billing) per the RBAC matrix.
-- Placed immediately after `owner` to match prisma/auth.prisma. Not USED in
-- this migration, so adding it inside the migration transaction is safe.
-- ─────────────────────────────────────────────────────────────────────────────
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'admin' AFTER 'owner';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — Drop the FKs and indexes anchored on the columns being removed.
-- ─────────────────────────────────────────────────────────────────────────────

-- DropForeignKey
ALTER TABLE "certificates" DROP CONSTRAINT "certificates_user_id_fkey";

-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "courses" DROP CONSTRAINT "courses_created_by_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_user_id_fkey";

-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_facility_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_manager_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";

-- F-053: the old partial unique index is keyed on the `user_id` column being
-- dropped below. Removed explicitly here and re-created on
-- (organization_user_id, course_id) in STEP 8.
-- DropIndex
DROP INDEX IF EXISTS "enrollments_user_id_course_id_active_key";

-- DropIndex
DROP INDEX "certificates_user_id_idx";

-- DropIndex
DROP INDEX "courses_created_by_idx";

-- DropIndex
DROP INDEX "documents_user_id_idx";

-- DropIndex
DROP INDEX "enrollments_user_id_course_id_idx";

-- DropIndex
DROP INDEX "notification_preferences_user_id_type_key";

-- DropIndex
DROP INDEX "notifications_user_id_created_at_idx";

-- DropIndex
DROP INDEX "notifications_user_id_is_read_idx";

-- DropIndex
DROP INDEX "users_facility_id_idx";

-- DropIndex
DROP INDEX "users_manager_id_idx";

-- DropIndex
DROP INDEX "users_organization_id_idx";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4 — Merge `profiles` into `users`.
--
-- `profiles.id` IS `users.id` (shared PK), so this is a straight 1:1 column
-- relocation on a table whose rows survive — the copy is deterministic and
-- requires no inference, unlike the membership rows. `email` is dropped
-- (duplicate of users.email), `company_name` is superseded by
-- organizations.name, and `job_title` relocates to organization_users, which
-- starts empty and so has nothing to receive it.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "has_seen_auditor_welcome" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_active_organization_id" TEXT,
ADD COLUMN     "last_name" TEXT;

UPDATE "users" u
SET "first_name"               = p."first_name",
    "last_name"                = p."last_name",
    "full_name"                = p."full_name",
    "avatar_url"               = p."avatar_url",
    "has_seen_auditor_welcome" = p."has_seen_auditor_welcome"
FROM "profiles" p
WHERE p."id" = u."id";

-- DropTable
DROP TABLE "profiles";

-- Org-scoped identity columns now live on organization_users.
-- AlterTable
ALTER TABLE "users" DROP COLUMN "facility_id",
DROP COLUMN "last_login_at",
DROP COLUMN "manager_id",
DROP COLUMN "organization_id",
DROP COLUMN "role",
DROP COLUMN "role_assigned_at";

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5 — Repoint the tenant-artifact owner columns onto organization_users.
-- Safe as NOT NULL without a default because STEP 1 emptied these tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "certificates" DROP COLUMN "user_id",
ADD COLUMN     "organization_user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "approved_by_user_id",
DROP COLUMN "created_by",
ADD COLUMN     "approved_by_org_user_id" TEXT,
ADD COLUMN     "created_by_org_user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "user_id",
ADD COLUMN     "organization_user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "user_id",
ADD COLUMN     "organization_user_id" TEXT NOT NULL;

-- Every invite now targets a specific facility, replacing the ambiguous
-- "first facility of org" fallback.
-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "facility_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "notification_preferences" DROP COLUMN "user_id",
ADD COLUMN     "organization_user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "user_id",
ADD COLUMN     "organization_user_id" TEXT NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6 — The membership tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "organization_users" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "job_title" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "manager_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role_assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_user_facilities" (
    "id" TEXT NOT NULL,
    "organization_user_id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "organization_user_facilities_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 7 — Indexes.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE INDEX "organization_users_organization_id_idx" ON "organization_users"("organization_id");

-- CreateIndex
CREATE INDEX "organization_users_organization_id_role_idx" ON "organization_users"("organization_id", "role");

-- CreateIndex
CREATE INDEX "organization_users_organization_id_active_idx" ON "organization_users"("organization_id", "active");

-- CreateIndex
CREATE INDEX "organization_users_manager_id_idx" ON "organization_users"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_user_id_organization_id_key" ON "organization_users"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "organization_user_facilities_facility_id_idx" ON "organization_user_facilities"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_user_facilities_organization_user_id_facility__key" ON "organization_user_facilities"("organization_user_id", "facility_id");

-- CreateIndex
CREATE INDEX "certificates_organization_user_id_idx" ON "certificates"("organization_user_id");

-- CreateIndex
CREATE INDEX "courses_created_by_org_user_id_idx" ON "courses"("created_by_org_user_id");

-- CreateIndex
CREATE INDEX "documents_organization_user_id_idx" ON "documents"("organization_user_id");

-- CreateIndex
CREATE INDEX "enrollments_organization_user_id_course_id_idx" ON "enrollments"("organization_user_id", "course_id");

-- CreateIndex
CREATE INDEX "invites_facility_id_idx" ON "invites"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_organization_user_id_type_key" ON "notification_preferences"("organization_user_id", "type");

-- CreateIndex
CREATE INDEX "notifications_organization_user_id_created_at_idx" ON "notifications"("organization_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_user_id_is_read_idx" ON "notifications"("organization_user_id", "is_read");

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 8 — F-053, rekeyed.
--
-- At most one *active* enrollment per (organization_user_id, course_id).
-- "Active" = the in-flight statuses enrolled | assigned | in_progress |
-- lessons_complete. Terminal/historical statuses (completed, attested, locked,
-- failed, retry_requested) are deliberately EXCLUDED so a retake — a new
-- enrollment created while the previous attempt stays completed/failed — does
-- not collide with its own history.
--
-- Filtered/partial uniques are not expressible in Prisma, so this lives only at
-- the DB level (documented in prisma/enrollment.prisma). No dedupe pass is
-- needed: STEP 1 emptied the table.
-- ─────────────────────────────────────────────────────────────────────────────
-- CreateIndex
CREATE UNIQUE INDEX "enrollments_org_user_id_course_id_active_key"
  ON "enrollments"("organization_user_id", "course_id")
  WHERE "status" IN ('enrolled', 'assigned', 'in_progress', 'lessons_complete');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 9 — Foreign keys.
-- ─────────────────────────────────────────────────────────────────────────────

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_approved_by_org_user_id_fkey" FOREIGN KEY ("approved_by_org_user_id") REFERENCES "organization_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_org_user_id_fkey" FOREIGN KEY ("created_by_org_user_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "organization_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_user_facilities" ADD CONSTRAINT "organization_user_facilities_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_user_facilities" ADD CONSTRAINT "organization_user_facilities_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

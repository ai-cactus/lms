/*
  Migration: String → Enum types for status/role columns.
  
  This migration converts existing text columns to PostgreSQL enum types.
  Existing data is preserved by casting text values to the new enum types.
  The USING clause maps each text value to its corresponding enum value.
  
  IMPORTANT: This migration assumes all existing string values match one of
  the defined enum values. Any orphaned/invalid values will cause the migration
  to fail (which is the desired safety behavior).
*/

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'worker');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('enrolled', 'in_progress', 'completed', 'attested', 'locked');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('starter', 'professional', 'enterprise');

-- CreateEnum
CREATE TYPE "SubscriptionBillingCycle" AS ENUM ('monthly', 'quarterly', 'yearly');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled', 'trialing');

-- ── User.role: text → UserRole ──────────────────────────────────────────────
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'worker';

-- ── Invite.role: text → UserRole ────────────────────────────────────────────
ALTER TABLE "Invite" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Invite" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole";
ALTER TABLE "Invite" ALTER COLUMN "role" SET DEFAULT 'worker';

-- ── Invite.status: text → InviteStatus ──────────────────────────────────────
ALTER TABLE "Invite" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invite" ALTER COLUMN "status" TYPE "InviteStatus" USING "status"::"InviteStatus";
ALTER TABLE "Invite" ALTER COLUMN "status" SET DEFAULT 'pending';

-- ── Course.status: text → CourseStatus ──────────────────────────────────────
-- Drop existing index first (it was on text column)
DROP INDEX IF EXISTS "Course_status_idx";
ALTER TABLE "Course" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Course" ALTER COLUMN "status" TYPE "CourseStatus" USING "status"::"CourseStatus";
ALTER TABLE "Course" ALTER COLUMN "status" SET DEFAULT 'draft';

-- ── Job.status: text → JobStatus ────────────────────────────────────────────
-- Drop existing index first
DROP INDEX IF EXISTS "Job_status_idx";
ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus" USING "status"::"JobStatus";
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'queued';

-- ── Enrollment.status: text → EnrollmentStatus ─────────────────────────────
ALTER TABLE "Enrollment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Enrollment" ALTER COLUMN "status" TYPE "EnrollmentStatus" USING "status"::"EnrollmentStatus";
ALTER TABLE "Enrollment" ALTER COLUMN "status" SET DEFAULT 'enrolled';

-- ── Subscription fields: text → enums ──────────────────────────────────────
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE "SubscriptionPlan" USING "plan"::"SubscriptionPlan";
ALTER TABLE "Subscription" ALTER COLUMN "billingCycle" TYPE "SubscriptionBillingCycle" USING "billingCycle"::"SubscriptionBillingCycle";
ALTER TABLE "Subscription" ALTER COLUMN "status" TYPE "SubscriptionStatus" USING "status"::"SubscriptionStatus";

-- ── Recreate indexes on enum columns ────────────────────────────────────────
CREATE INDEX "Course_status_idx" ON "Course"("status");
CREATE INDEX "Job_status_idx" ON "Job"("status");

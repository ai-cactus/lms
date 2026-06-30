-- CreateEnum
CREATE TYPE "ReminderStage" AS ENUM ('INITIAL_LAUNCH', 'FRIENDLY_REMINDER', 'URGENT_REMINDER', 'DAY_OF_DEADLINE', 'GRACE_SOFT_ESCALATION', 'HARD_ESCALATION');

-- CreateEnum
CREATE TYPE "ReminderNudgeKind" AS ENUM ('WORKER_RETAKE', 'ADMIN_REASSIGN');

-- DropForeignKey
ALTER TABLE "assignment_reminders" DROP CONSTRAINT "assignment_reminders_assignment_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "manager_id" TEXT;

-- AlterTable
ALTER TABLE "course_assignments" ADD COLUMN     "due_at" TIMESTAMP(3),
ADD COLUMN     "due_window_days" INTEGER,
ADD COLUMN     "reminders_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "timezone" TEXT;

-- DropTable
DROP TABLE "assignment_reminders";

-- CreateTable
CREATE TABLE "assignment_reminder_stages" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "stage" "ReminderStage" NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY['email', 'in_app']::TEXT[],

    CONSTRAINT "assignment_reminder_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "stage" "ReminderStage" NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_date" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_nudges" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "kind" "ReminderNudgeKind" NOT NULL,
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "reminder_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_reminder_stages_assignment_id_idx" ON "assignment_reminder_stages"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_reminder_stages_assignment_id_stage_key" ON "assignment_reminder_stages"("assignment_id", "stage");

-- CreateIndex
CREATE INDEX "reminder_logs_enrollment_id_idx" ON "reminder_logs"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_logs_enrollment_id_stage_key" ON "reminder_logs"("enrollment_id", "stage");

-- CreateIndex
CREATE INDEX "reminder_nudges_enrollment_id_idx" ON "reminder_nudges"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_nudges_enrollment_id_kind_key" ON "reminder_nudges"("enrollment_id", "kind");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "enrollments_status_due_at_idx" ON "enrollments"("status", "due_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_reminder_stages" ADD CONSTRAINT "assignment_reminder_stages_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "course_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_nudges" ADD CONSTRAINT "reminder_nudges_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

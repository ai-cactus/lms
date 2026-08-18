-- Pending course assignments parked on a staff Invite (fix/worker-invite).
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY this table — the
-- diff engine otherwise also emits a spurious DROP of the raw-SQL-managed
-- `manual_chunks` pgvector HNSW index and the DB-level defaults on `facilities`.
--
-- Assigning a course to an unknown / org-less email now creates a `/join` Invite
-- instead of a premature user account; the course is stored here and turned into
-- a real Enrollment when the invite is accepted (see enrollInviteCourses).

-- CreateTable
CREATE TABLE "invite_course_assignments" (
    "id" TEXT NOT NULL,
    "invite_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_course_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_course_assignments_course_id_idx" ON "invite_course_assignments"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_course_assignments_invite_id_course_id_key" ON "invite_course_assignments"("invite_id", "course_id");

-- AddForeignKey
ALTER TABLE "invite_course_assignments" ADD CONSTRAINT "invite_course_assignments_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_course_assignments" ADD CONSTRAINT "invite_course_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

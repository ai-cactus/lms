-- F-003: PhiReport scanner version (nullable, defaults to 'v2')
-- AlterTable
ALTER TABLE "phi_reports" ADD COLUMN     "scanner_version" TEXT DEFAULT 'v2';

-- F-059: session invalidation counter on users
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;

-- F-051: Course review gate
-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "review_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quality_warnings" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- F-014: Stripe webhook idempotency ledger
-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- F-020: EmailMessage delivery-tracking
-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reminder_log_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- F-014: unique constraint enforcing at-most-once webhook processing
-- CreateIndex
CREATE UNIQUE INDEX "processed_webhook_events_stripe_event_id_key" ON "processed_webhook_events"("stripe_event_id");

-- F-020: EmailMessage retry-sweep index
-- CreateIndex
CREATE INDEX "email_messages_status_attempts_idx" ON "email_messages"("status", "attempts");

-- F-032: QuizAttempt append-history — drop the (enrollment_id, quiz_id) unique, add a completed_at ordering index
-- DropIndex
DROP INDEX "quiz_attempts_enrollment_id_quiz_id_key";

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollment_id_quiz_id_completed_at_idx" ON "quiz_attempts"("enrollment_id", "quiz_id", "completed_at");

-- F-027: missing foreign-key / lookup indexes
-- CreateIndex
CREATE INDEX "lessons_course_id_idx" ON "lessons"("course_id");

-- CreateIndex
CREATE INDEX "questions_quiz_id_idx" ON "questions"("quiz_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_idx" ON "document_versions"("document_id");

-- CreateIndex
CREATE INDEX "mapping_evidence_document_version_id_idx" ON "mapping_evidence"("document_version_id");

-- CreateIndex
CREATE INDEX "course_versions_course_id_idx" ON "course_versions"("course_id");

-- CreateIndex
CREATE INDEX "course_versions_document_version_id_idx" ON "course_versions"("document_version_id");

-- CreateIndex
CREATE INDEX "invites_organization_id_idx" ON "invites"("organization_id");

-- F-027 (raw): HNSW approximate-nearest-neighbour index for RAG cosine search over the
-- pgvector `embedding` column on manual_chunks. Not modelled in Prisma (Unsupported column),
-- so it is created here directly and guarded with IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS "manual_chunks_embedding_hnsw_idx" ON "manual_chunks" USING hnsw (embedding vector_cosine_ops);

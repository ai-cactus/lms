-- Append-only ledger of PHI-scan decisions (F-092).
--
-- Two statements Prisma generated here were REMOVED by hand. Re-check for both
-- on every future migration:
--
--   1. DROP INDEX "manual_chunks_embedding_hnsw_idx";
--      The HNSW vector index is created by raw SQL because Prisma cannot model
--      pgvector index types, so `migrate dev` sees it as drift and tries to drop
--      it on every migration. Applying that would silently destroy RAG query
--      performance (the index F-027 added).
--
--   2. ALTER TABLE "facilities" ALTER COLUMN "id" DROP DEFAULT,
--      ALTER COLUMN "updated_at" DROP DEFAULT;
--      Unrelated pre-existing drift between the live schema and the Prisma
--      schema. A migration should do one thing, and dropping the default on a
--      primary key risks breaking inserts that rely on it. Tracked separately —
--      it needs its own investigation and migration, not a silent ride-along.

-- CreateTable
CREATE TABLE "phi_decisions" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "decided_by" TEXT,
    "document_version_id" TEXT,
    "detector_version" TEXT NOT NULL,
    "finding_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "finding_count" INTEGER NOT NULL DEFAULT 0,
    "entities" JSONB,
    "content_hash" TEXT,
    "content_length" INTEGER,
    "filename_hash" TEXT,
    "actor_id" TEXT,
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phi_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phi_decisions_organization_id_created_at_idx" ON "phi_decisions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "phi_decisions_outcome_created_at_idx" ON "phi_decisions"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "phi_decisions_content_hash_idx" ON "phi_decisions"("content_hash");

-- ─────────────────────────────────────────────────────────────────────────────
-- Deleting a course or a document ARCHIVES and RETAINS it (Q24).
--
-- `archived_at` is the soft-delete marker — null means live — and
-- `archived_by_org_user_id` records who archived it. The FK is ON DELETE SET
-- NULL so losing the actor never loses the archive record itself.
--
-- The composite `(organization_id, archived_at)` index is the shape of the new
-- default access pattern: one org's live rows. Deliberately NOT a partial
-- (`WHERE archived_at IS NULL`) index — Prisma's DSL has no WHERE on @@index,
-- so a filtered index would need the same hand-maintenance as the raw-SQL HNSW
-- one below, for tables nowhere near the row count that would justify it.
--
-- Purely additive: nothing reads or writes these columns yet. `deleteCourse`
-- and `deleteDocument` are still hard deletes; they move onto archiving in a
-- later PR, once this is proven live.
--
-- Two statements `migrate dev` generated were REMOVED by hand. Re-check for
-- both on every future migration:
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
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "archived_by_org_user_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "archived_by_org_user_id" TEXT;

-- CreateIndex
CREATE INDEX "courses_organization_id_archived_at_idx" ON "courses"("organization_id", "archived_at");

-- CreateIndex
CREATE INDEX "documents_organization_id_archived_at_idx" ON "documents"("organization_id", "archived_at");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_archived_by_org_user_id_fkey" FOREIGN KEY ("archived_by_org_user_id") REFERENCES "organization_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_archived_by_org_user_id_fkey" FOREIGN KEY ("archived_by_org_user_id") REFERENCES "organization_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

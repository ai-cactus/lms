-- ─────────────────────────────────────────────────────────────────────────────
-- Courses and documents belong to the ORGANIZATION (Q25), not to their author.
--
-- Today ownership is derived at read time by joining through the creator's
-- OrganizationUser row. This adds the direct column so tenancy can be a WHERE
-- clause. Purely additive: nothing reads or writes `organization_id` yet — the
-- application code moves onto it in a later PR, once this is proven live.
--
-- Applied in three steps:
--   1. ADD COLUMN nullable
--   2. backfill from the author's membership
--   3. FK + index
--
-- The column is INTENTIONALLY NULLABLE at this step. The backfill below
-- populates every existing row, so nothing is left null in practice — but this
-- PR deliberately adds no writer, and a NOT NULL column with no writer takes
-- down every INSERT that omits it. Course creation and document upload would
-- be dead from the moment this applied until PR B shipped.
--
-- The sequence is expand → write → contract: PR B adds the writers and the
-- reads, then `add_course_document_organization_id_not_null` carries the
-- `SET NOT NULL` once every insert path supplies the column.
--
-- ⛔ PRE-FLIGHT — both queries MUST return 0 before this runs anywhere real.
-- A row whose author has no membership would silently stay null here and then
-- abort PR B's `SET NOT NULL`:
--
--   SELECT count(*) FROM courses c
--     LEFT JOIN organization_users ou ON ou.id = c.created_by_org_user_id
--    WHERE ou.id IS NULL;
--
--   SELECT count(*) FROM documents d
--     LEFT JOIN organization_users ou ON ou.id = d.organization_user_id
--    WHERE ou.id IS NULL;
--
-- The join is total by construction — `courses.created_by_org_user_id`,
-- `documents.organization_user_id` and `organization_users.organization_id` are
-- all NOT NULL with enforced foreign keys — so this is a confirmation, not a
-- gamble. Verify it anyway: a wrong backfill is the one failure here that a
-- follow-up commit cannot repair.
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
ALTER TABLE "courses" ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "organization_id" TEXT;

-- Backfill: the owning org is the one the author was a member of.
UPDATE "courses" c
   SET "organization_id" = ou."organization_id"
  FROM "organization_users" ou
 WHERE c."created_by_org_user_id" = ou."id";

UPDATE "documents" d
   SET "organization_id" = ou."organization_id"
  FROM "organization_users" ou
 WHERE d."organization_user_id" = ou."id";

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "courses_organization_id_idx" ON "courses"("organization_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");

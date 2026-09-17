-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRACT step of expand → write → contract: `courses.organization_id` and
-- `documents.organization_id` become NOT NULL (Q25).
--
-- PR A (`add_course_document_organization_id`) added both columns nullable and
-- backfilled every row, deliberately without a writer — a NOT NULL column with
-- no writer takes down every INSERT. This PR added the writers (every
-- `course.create` / `document.create`, the seeds and the seed scripts), so the
-- constraint can now close behind them.
--
-- ⚠️ BUNDLING THE CONSTRAINT WITH ITS WRITERS IS SAFE ONLY ON THIS TOPOLOGY.
-- Deploys here are Docker Compose with ONE app container per environment,
-- stopped → migrated → started, so no old instance is ever running while the
-- constraint is in place: there is no window in which code that omits the
-- column can insert. If this ever becomes a rolling deploy, a blue/green cut or
-- anything else that runs two app versions at once, the constraint MUST ship in
-- a later release than the writers — otherwise the still-running old container
-- fails every course creation and document upload between the migration and the
-- last pod rolling over.
--
-- The re-backfill below is not redundant with PR A's. PR A ran on each
-- environment at its own deploy, and the column stayed nullable afterwards, so
-- anything created on dev or staging BETWEEN the two deploys has a NULL that
-- would abort `SET NOT NULL`. It is idempotent and touches only NULL rows;
-- verified as a no-op on dev (0 null rows in each table at authoring time).
--
-- ⛔ PRE-FLIGHT — both queries MUST return 0 before this runs anywhere real.
-- A row whose author has no membership cannot be backfilled and will abort the
-- constraint:
--
--   SELECT count(*) FROM courses c
--     LEFT JOIN organization_users ou ON ou.id = c.created_by_org_user_id
--    WHERE c."organization_id" IS NULL AND ou.id IS NULL;
--
--   SELECT count(*) FROM documents d
--     LEFT JOIN organization_users ou ON ou.id = d.organization_user_id
--    WHERE d."organization_id" IS NULL AND ou.id IS NULL;
--
-- Two statements `migrate diff` generated were REMOVED by hand. Both were
-- confirmed present in this migration's own diff before removal. Re-check for
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

-- Backfill any row created while the column was still nullable and unwritten.
UPDATE "courses" c
   SET "organization_id" = ou."organization_id"
  FROM "organization_users" ou
 WHERE c."created_by_org_user_id" = ou."id"
   AND c."organization_id" IS NULL;

UPDATE "documents" d
   SET "organization_id" = ou."organization_id"
  FROM "organization_users" ou
 WHERE d."organization_user_id" = ou."id"
   AND d."organization_id" IS NULL;

-- AlterTable
ALTER TABLE "courses" ALTER COLUMN "organization_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "organization_id" SET NOT NULL;

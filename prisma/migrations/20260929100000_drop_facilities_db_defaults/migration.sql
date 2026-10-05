-- ─────────────────────────────────────────────────────────────────────────────
-- TOOL-24: drop the DB-level defaults on facilities.id and facilities.updated_at.
--
-- 20260701130000_add_facility hand-wrote `DEFAULT gen_random_uuid()` and
-- `DEFAULT CURRENT_TIMESTAMP` on these columns, but the schema declares them as
-- `@default(uuid())` / `@updatedAt` — values the Prisma client supplies on every
-- write, exactly like every other table here. So `prisma migrate diff` against a
-- freshly migrated database has always proposed dropping both defaults, and
-- several migrations since have had to strip that hunk by hand.
--
-- The schema is the side that is right: every facility the app creates goes
-- through the Prisma client, and every raw-SQL insert in the repository (the
-- e2e specs' fixtures) names id and updated_at explicitly. Nothing reads the
-- defaults, so dropping them changes no stored row and no write path.
--
-- DROP DEFAULT is a no-op on a column without one, so a re-run is safe.
--
-- HAND-AUTHORED. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the
-- pgvector HNSW index is raw-SQL-managed and `migrate diff` re-emits a DROP for
-- it every time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "facilities" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

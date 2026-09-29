-- ─────────────────────────────────────────────────────────────────────────────
-- BUG-25 — keep the approver's / archiver's name when their member is deleted.
--
-- courses.approved_by_org_user_id, courses.archived_by_org_user_id and
-- documents.archived_by_org_user_id are all `ON DELETE SET NULL`, so deleting
-- the member left each record approved/archived by nobody. Each FK now gets a
-- name snapshot written alongside it by the app.
--
-- The backfill copies the CURRENT full name of the member each FK still points
-- at. Rows whose member is already gone (FK already NULL) cannot be recovered,
-- and a member with no full name gets no snapshot (NULL, never an email —
-- a deleted person's address is not kept on the record).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and every UPDATE only touches rows
-- whose snapshot IS NULL, so a re-run changes nothing (UPDATE 0).
--
-- HAND-AUTHORED. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the
-- pgvector HNSW index is raw-SQL-managed and `migrate dev` re-emits a DROP for
-- it every time. No indexes: the columns are display-only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "approved_by_name" TEXT;
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "archived_by_name" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "archived_by_name" TEXT;

UPDATE "courses" c
SET "approved_by_name" = NULLIF(TRIM(u."full_name"), '')
FROM "organization_users" ou
JOIN "users" u ON u."id" = ou."user_id"
WHERE c."approved_by_org_user_id" = ou."id"
  AND c."approved_by_name" IS NULL
  AND NULLIF(TRIM(u."full_name"), '') IS NOT NULL;

UPDATE "courses" c
SET "archived_by_name" = NULLIF(TRIM(u."full_name"), '')
FROM "organization_users" ou
JOIN "users" u ON u."id" = ou."user_id"
WHERE c."archived_by_org_user_id" = ou."id"
  AND c."archived_by_name" IS NULL
  AND NULLIF(TRIM(u."full_name"), '') IS NOT NULL;

UPDATE "documents" d
SET "archived_by_name" = NULLIF(TRIM(u."full_name"), '')
FROM "organization_users" ou
JOIN "users" u ON u."id" = ou."user_id"
WHERE d."archived_by_org_user_id" = ou."id"
  AND d."archived_by_name" IS NULL
  AND NULLIF(TRIM(u."full_name"), '') IS NOT NULL;

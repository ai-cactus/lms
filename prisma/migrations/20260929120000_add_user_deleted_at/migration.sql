-- ─────────────────────────────────────────────────────────────────────────────
-- users.deleted_at — Q-23 (2026-09-28): deleting a user keeps their compliance
-- records. The system-admin delete no longer removes the row; it deactivates
-- every membership and stamps this column, and every sign-in path refuses an
-- identity where it is set.
--
-- Nullable with no backfill: every existing identity is live, so NULL is the
-- correct value for all of them. The index serves the /system user list's
-- active/deleted filter.
--
-- HAND-AUTHORED and idempotent (IF NOT EXISTS on both statements). No
-- `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the pgvector HNSW index is
-- raw-SQL-managed and `migrate dev` re-emits a DROP for it every time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users"("deleted_at");

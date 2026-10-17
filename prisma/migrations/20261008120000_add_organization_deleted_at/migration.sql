-- organizations.deleted_at — /system organization soft delete (2026-10-08).
-- Nullable, no backfill: every existing organization is live. No index: the
-- column is read through joins on already-indexed keys, and the /system list
-- is small. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the pgvector
-- HNSW index is raw-SQL-managed and `migrate dev` re-emits a DROP for it.
ALTER TABLE "organizations" ADD COLUMN "deleted_at" TIMESTAMP(3);

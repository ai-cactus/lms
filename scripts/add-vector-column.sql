-- add-vector-column.sql
--
-- Run ONCE after `prisma migrate deploy` has created the ManualChunk table.
-- This script adds the pgvector embedding column and an IVFFlat index that
-- Prisma cannot manage natively (Unsupported type).
--
-- Idempotent: the IF NOT EXISTS guards make it safe to re-run.
--
-- Usage (dev):
--   docker exec -i lms-dev-db psql -U postgres -d lms < scripts/add-vector-column.sql
--
-- Usage (staging/production) — run once after the migration is deployed:
--   docker exec -i lms-staging-db psql -U lms -d lms_staging < scripts/add-vector-column.sql
--   docker exec -i lms-production-db psql -U lms -d lms_production < scripts/add-vector-column.sql

-- 1. Enable the pgvector extension (requires pgvector/pgvector image).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add the embedding column to ManualChunk (768 dims = text-embedding-004).
ALTER TABLE "ManualChunk"
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. Create an IVFFlat index for approximate nearest-neighbour cosine search.
--    lists = 100 is a reasonable default for up to ~1M chunks; tune as needed.
--    The index is only useful once rows exist, so it can be created lazily,
--    but creating it upfront avoids a later lock on a large table.
CREATE INDEX IF NOT EXISTS manual_chunk_embedding_cosine_idx
  ON "ManualChunk"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Done.
SELECT 'pgvector column and index ready.' AS status;

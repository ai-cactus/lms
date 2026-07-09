---
name: migrate-dev-hnsw-drift
description: prisma migrate dev spuriously emits DROP INDEX manual_chunks_embedding_hnsw_idx (raw-SQL pgvector HNSW index) — strip it from every new migration
metadata:
  type: project
---

`npx prisma migrate dev` prepends a spurious `DROP INDEX "manual_chunks_embedding_hnsw_idx";` to EVERY new migration it generates.

**Why:** the HNSW index on `manual_chunks.embedding` is created via raw SQL (in migration `20260705120000_audit_wave2_schema`) and cannot be modeled in `prisma/category.prisma` — `embedding` is `Unsupported("vector(768)")` and Prisma has no HNSW index syntax. So Prisma's schema-vs-DB diff always sees the DB index as "extra" and wants to drop it.

**How to apply:** after `migrate dev` generates a migration, open the `migration.sql` and delete the `-- DropIndex` / `DROP INDEX "manual_chunks_embedding_hnsw_idx";` lines, leaving only your intended change. If it already applied and dropped the index locally, recover:
1. `CREATE INDEX IF NOT EXISTS "manual_chunks_embedding_hnsw_idx" ON "manual_chunks" USING hnsw (embedding vector_cosine_ops)` against the DB.
2. Reconcile Prisma's stored checksum: it is `sha256hex(migration.sql file bytes)` — `UPDATE _prisma_migrations SET checksum = <sha> WHERE migration_name = '<name>'`, else `migrate dev`/`deploy` errors "modified after applied".
3. `npx prisma migrate status` should then report "up to date".

DB is at `DATABASE_URL` (localhost:5433); load it in node scripts with `require('dotenv').config()` first (see [[offline-migrations]]).

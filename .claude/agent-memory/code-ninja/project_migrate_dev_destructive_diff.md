---
name: migrate-dev-destructive-diff
description: prisma migrate dev on this repo autogen's DESTRUCTIVE diff noise (drops pgvector embedding + its HNSW index + facility defaults) — hand-author migrations instead
metadata:
  type: project
---

`npx prisma migrate dev` against this schema silently adds **destructive, unrelated statements** to the generated migration, because the DB holds objects the Prisma datamodel does not model:

- `ALTER TABLE "manual_chunks" DROP COLUMN "embedding";` — `embedding` is a `vector(768)` pgvector column **managed via raw SQL** (see `prisma/category.prisma` `ManualChunk` note), intentionally absent from the model, so the diff engine always wants to drop it. Dropping it loses all RAG embedding data.
- `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — prepended to EVERY generated migration. The HNSW index on `manual_chunks.embedding` is created via raw SQL (migration `20260705120000_audit_wave2_schema`) and cannot be modeled: `embedding` is `Unsupported("vector(768)")` and Prisma has no HNSW index syntax, so the DB index always looks "extra".
- `ALTER TABLE "facilities" ALTER COLUMN "id"/"updated_at" DROP DEFAULT;` — the hand-authored `add_facility` migration set DB-level `gen_random_uuid()` / `CURRENT_TIMESTAMP` defaults; Prisma manages these app-side and wants to drop the DB defaults.

**Why:** the repo hand-authors migrations (`add_facility`, `add_manualchunk_embedding_vector`) precisely to avoid this; `migrate dev` autogen re-introduces the noise.

**`--create-only` does NOT hang** (confirmed 2026-09-16, Prisma 7.10): `npx prisma migrate dev --create-only --name <n>` applies any pending migrations, writes the new folder, and exits. It is the practical way to scaffold the DDL and see the drift statements in situ before stripping them. Only the bare `migrate dev` hangs:

**It also HANGS.** Because that drift is permanent, `npx prisma migrate dev` applies any pending hand-authored migration and then blocks forever on the interactive "Enter a name for the new migration" prompt for the leftover diff. In a non-interactive agent shell that reads as a timeout — the migration usually DID apply, so check `_prisma_migrations` before assuming failure, then kill the process. There is no `--skip-generate`-style flag that suppresses the prompt.

**Best avoidance: never let the live DB be one side of the diff.** A schema→schema diff (`migrate diff --from-schema <HEAD copy> --to-schema <working copy> --script`, per [[offline-migrations]]) emits ONLY the intended DDL — no `DROP INDEX`, no `DROP COLUMN embedding`, no facility-default drops. Confirmed 2026-08-08 adding `video_encoding_version`: output was the two `ADD COLUMN`s and nothing else.

**Verification recipe (Prisma 7.8):** apply by hand-authoring the folder, then confirm with `npx prisma migrate status` (expect "Database schema is up to date!") and `npx prisma migrate diff --from-config-datasource --to-schema prisma --script` — a clean run leaves ONLY the three known drift statements above. Prisma 7 REMOVED the older flag spellings (`--from-schema-datasource`, `--to-schema-datamodel`); use `--from-config-datasource` / `--to-schema`.

**How to apply:** when adding a table/column, hand-write `prisma/migrations/<ts>_<name>/migration.sql` with ONLY the intended DDL (model the table in the `.prisma` schema, `prisma generate` for types, but do NOT trust `migrate dev`'s SQL). If you did generate with `migrate dev`, delete the `-- DropIndex` / `DROP INDEX "manual_chunks_embedding_hnsw_idx";` lines and the other drift statements before applying.

**Recovery if a bad diff already applied:**
1. Restore the DB objects: `ADD COLUMN embedding vector(768)`; `CREATE INDEX IF NOT EXISTS "manual_chunks_embedding_hnsw_idx" ON "manual_chunks" USING hnsw (embedding vector_cosine_ops)`; `SET DEFAULT gen_random_uuid()` / `CURRENT_TIMESTAMP` on the facility columns.
2. Rewrite the migration.sql to the clean DDL.
3. Reconcile the stored checksum, else `migrate dev`/`deploy` errors "modified after applied". Either `DELETE FROM _prisma_migrations WHERE migration_name=...` then `prisma migrate resolve --applied <name>`, or set it directly: the checksum is `sha256hex(migration.sql file bytes)` — `UPDATE _prisma_migrations SET checksum = <sha> WHERE migration_name = '<name>'`.
4. `npx prisma migrate status` should report "up to date".

DB is at `DATABASE_URL` (localhost:5433); load it in node scripts with `require('dotenv').config()` first. See also [[offline-migrations]].

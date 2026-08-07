---
name: migrate-dev-destructive-diff
description: prisma migrate dev on this repo autogen's DESTRUCTIVE diff noise (drops pgvector embedding + facility defaults) — hand-author migrations instead
metadata:
  type: project
---

`npx prisma migrate dev` against this schema silently adds **destructive, unrelated statements** to the generated migration, because the DB holds objects the Prisma datamodel does not model:

- `ALTER TABLE "manual_chunks" DROP COLUMN "embedding";` — `embedding` is a `vector(768)` pgvector column **managed via raw SQL** (see `prisma/category.prisma` `ManualChunk` note), intentionally absent from the model, so the diff engine always wants to drop it. Dropping it loses all RAG embedding data.
- `ALTER TABLE "facilities" ALTER COLUMN "id"/"updated_at" DROP DEFAULT;` — the hand-authored `add_facility` migration set DB-level `gen_random_uuid()` / `CURRENT_TIMESTAMP` defaults; Prisma manages these app-side and wants to drop the DB defaults.

**Why:** the repo hand-authors migrations (`add_facility`, `add_manualchunk_embedding_vector`) precisely to avoid this; `migrate dev` autogen re-introduces the noise.

**It also HANGS.** Because that drift is permanent, `npx prisma migrate dev` applies any pending hand-authored migration and then blocks forever on the interactive "Enter a name for the new migration" prompt for the leftover diff. In a non-interactive agent shell that reads as a timeout — the migration usually DID apply, so check `_prisma_migrations` before assuming failure, then kill the process. There is no `--skip-generate`-style flag that suppresses the prompt.

**Verification recipe (Prisma 7.8):** apply by hand-authoring the folder, then confirm with `npx prisma migrate status` (expect "Database schema is up to date!") and `npx prisma migrate diff --from-config-datasource --to-schema prisma --script` — a clean run leaves ONLY the two known drift statements above. Prisma 7 REMOVED the older flag spellings (`--from-schema-datasource`, `--to-schema-datamodel`) that [[offline-migrations]] documents; use `--from-config-datasource` / `--to-schema`.

**How to apply:** when adding a table/column, hand-write `prisma/migrations/<ts>_<name>/migration.sql` with ONLY the intended DDL (model the table in the `.prisma` schema, `prisma generate` for types, but do NOT trust `migrate dev`'s SQL). If you already ran `migrate dev` and it applied the bad diff: restore the DB (`ADD COLUMN embedding vector(768)`, `SET DEFAULT gen_random_uuid()`/`CURRENT_TIMESTAMP`), rewrite the migration.sql to the clean DDL, then reconcile history: `DELETE FROM _prisma_migrations WHERE migration_name=...` then `prisma migrate resolve --applied <name>` (records the new checksum without re-running SQL). Verify with `prisma migrate status`. See also [[offline-migrations]].

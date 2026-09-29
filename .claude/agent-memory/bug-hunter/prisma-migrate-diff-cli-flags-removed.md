---
name: prisma-migrate-diff-cli-flags-removed
description: prisma migrate diff dropped --from-url and --to-schema-datamodel; current flags and the migration-proof recipe
metadata:
  type: reference
---

As of the Prisma version on `dev` at 2026-09-29 (confirmed on branches merged from `origin/dev` `6ff2a990`), `prisma migrate diff` no longer accepts:
- `--from-url <url>` — removed. Use `--from-config-datasource <path-to-prisma.config.ts>` instead, with `DATABASE_URL` pointed at the target DB (this repo's `prisma.config.ts` reads `datasource.url` from `process.env.DATABASE_URL`, so exporting it before the call is enough).
- `--to-schema-datamodel <path>` — removed. Use `--to-schema <path>` (a directory or file) instead.

Both fail with a hard CLI usage error (not a silent no-op), so a migration-proof script written against the old flags breaks loudly rather than quietly.

**Working recipe** (throwaway `pgvector/pgvector:pg16` container, unique name/port):
```
export DATABASE_URL="postgresql://postgres:postgres@localhost:<port>/lms_migtest"
npx prisma migrate deploy
# re-run the new migration's .sql by hand via docker exec psql — must be a no-op
npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/ --script
```
Expect only the known HNSW false positive (`DROP INDEX "manual_chunks_embedding_hnsw_idx"`) in the diff output — any other hunk is real drift.

**Why:** every W3-era migration-proof task (bug-hunter validating a branch's new migration) hits this immediately if it copies an older recipe from a stale memory or a prior PR's notes.

**How to apply:** use the recipe above verbatim; don't rediscover it by trial and error against `--help` each time.

See also [[project-scripts-testing]] for the separate Prisma-7.8 `new PrismaClient()`-without-adapter throw.

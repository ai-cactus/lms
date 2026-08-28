---
name: offline-migrations
description: The dev Postgres (localhost:5433) is often unreachable in the agent env; scaffold Prisma migrations offline via migrate diff
metadata:
  type: project
---

The Prisma dev database (`DATABASE_URL` → `localhost:5433`, schema `public`, db `lms`) is frequently **unreachable from the agent environment** (`P1001` / `ECONNREFUSED`).

**If Docker is available**, you can bring up a real local pgvector Postgres on 5433 instead of scaffolding offline: `docker compose -f docker-compose.dev.yml up -d db` (service `db` = `pgvector/pgvector:pg16`, maps `5433:5432`, needs `POSTGRES_*` from `.env` — `source env` first; container name `lms-dev-db`, readiness via `docker exec lms-dev-db pg_isready -U postgres`). Verified it starts in ~1s with the migrated schema intact on its persisted volume. Use this when a task needs a live DB (smoke tests, `migrate dev`, seeding).

**Why:** the DB runs outside the agent sandbox, so `prisma migrate dev` — and even `prisma migrate dev --create-only` — fail because both need a live connection (shadow DB for diffing).

**How to apply:** when asked to create a migration and the DB is down, scaffold it offline instead of giving up:
0. **Do NOT reach for `--from-migrations`.** In Prisma 7 it demands `datasource.shadowDatabaseUrl` in `prisma.config.ts` (there is no `--shadow-database-url` CLI flag any more) and errors out without it. Schema→schema is the only offline path.
1. Copy working-tree `prisma/*.prisma` to a temp NEW dir; copy the same to a temp OLD dir, then overwrite the changed files in OLD with their `git show HEAD:prisma/<f>.prisma` versions (HEAD = last-migrated state, valid only if migrations are in sync with committed schema).
   - Fastest way to build OLD when your change is uncommitted and HEAD *is* the baseline: `git archive HEAD prisma | tar -x -C <OLD>` — one command, whole folder, no per-file `git show`. Then diff `--from-schema <OLD>/prisma --to-schema prisma`. (Re-verified 2026-08-27 adding `subscriptions.pause_starts_at` + its index: output was exactly one `ADD COLUMN` and one `CREATE INDEX`, no HNSW `DROP INDEX`.)
   - **Stacked-PR variant:** when an earlier uncommitted PR already added schema fields (so HEAD is NOT your baseline), do NOT diff from HEAD — you would fold that PR's columns into your migration. Instead copy the working tree to OLD and delete only YOUR new field lines from it (plus their `///` doc-comment blocks), so the diff is exactly your own DDL. Verified on the poster columns: output was the two intended `ADD COLUMN`s and nothing else.
2. `npx prisma migrate diff --from-schema <OLD> --to-schema <NEW> --script --output prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
   - Prisma v7 renamed the flags: use `--from-schema` / `--to-schema` (NOT the removed `--from-schema-datamodel`). Datamodel inputs accept a schema **folder** (this repo uses modular `prisma/` via `prisma.config.ts` `schema: 'prisma/'`).
3. `npx prisma generate` and `npx prisma validate` work offline (no DB needed). The migration is **CREATED-ONLY** — report that it still needs `migrate deploy`/`migrate dev` against a live DB to apply.

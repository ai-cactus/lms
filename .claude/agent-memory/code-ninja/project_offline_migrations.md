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
1. Copy working-tree `prisma/*.prisma` to a temp NEW dir; copy the same to a temp OLD dir, then overwrite the changed files in OLD with their `git show HEAD:prisma/<f>.prisma` versions (HEAD = last-migrated state, valid only if migrations are in sync with committed schema).
2. `npx prisma migrate diff --from-schema <OLD> --to-schema <NEW> --script --output prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
   - Prisma v7 renamed the flags: use `--from-schema` / `--to-schema` (NOT the removed `--from-schema-datamodel`). Datamodel inputs accept a schema **folder** (this repo uses modular `prisma/` via `prisma.config.ts` `schema: 'prisma/'`).
3. `npx prisma generate` and `npx prisma validate` work offline (no DB needed). The migration is **CREATED-ONLY** — report that it still needs `migrate deploy`/`migrate dev` against a live DB to apply.

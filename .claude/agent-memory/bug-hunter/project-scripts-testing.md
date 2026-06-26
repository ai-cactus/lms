---
name: project-scripts-testing
description: How to test files in scripts/ — constraints, what works, and known blockers
metadata:
  type: project
---

## Scripts test placement

Tests for `scripts/*.mjs` workers live in `scripts/*.test.ts`. Vitest's default include glob picks them up without any config change (confirmed for `scripts/transcode-worker-*.test.ts`).

## transcode-worker.mjs testing constraints

**Can't import the worker directly**: `main()` runs at module level — importing it fires the full async pipeline.

**Child-process approach previously blocked by Bug 2**: The worker originally called `new PrismaClient()` (no args) at module level, which threw `PrismaClientInitializationError` in Prisma 7.8. Bug 2 is now fixed — the worker mirrors `db/index.ts` and passes the adapter. The child-process constraint remains because of the `main()` side-effect on import, not Prisma.

**Replicated-algorithm approach**: The only viable path for testing `getGcs()` logic without modifying the worker. The algorithm is verbatim-copied into the test and receives a `StorageCtor` parameter so the Storage constructor can be a `vi.fn()`. See `scripts/transcode-worker-gcs.test.ts`.

## Prisma 7.8 notes

- `require('@prisma/client')` via `createRequire` resolves fine (Bug 1 fixed)
- `require('@prisma/adapter-pg')` resolves fine — exports `{ PrismaPg }` via CJS
- `new PrismaClient()` (no args) — THROWS synchronously: `PrismaClientInitializationError` (no adapter = no engine)
- `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` — succeeds without connecting; `lesson.update` and `course.update` are callable immediately (Bug 2 fixed)
- PrismaPg does NOT connect until the first query — construction with a non-connecting URL is safe in tests
- Authoritative coverage for GCSProvider TS logic: `src/lib/storage/gcs-provider.test.ts`

**Why:** `import.meta.url` is available in Vitest test files (even under `jsdom` environment) and `createRequire(import.meta.url)` works as expected for resolving npm packages.

---
name: vitest-generated-alias
description: vitest.config.mts must alias @/generated and @/db separately or value-imports of generated Prisma fail in tests
metadata:
  type: project
---

`tsconfig.json` maps `@/generated/*` → `./generated/*` and `@/db/*` → `./db/*` (repo root, NOT under `src/`), with `@/*` → `./src/*` as the catch-all. `vitest.config.mts` originally only aliased `@` → `./src`, so any test whose import graph reached a **value** import of `@/generated/...` (e.g. `dispatch.ts` does `import { Prisma }` and uses `Prisma.PrismaClientKnownRequestError` at runtime) failed to transform with "Failed to resolve import @/generated/prisma/client".

**Why:** Type-only uses of `@/generated` get elided by esbuild so the gap stayed hidden; the first value-import pulled into a widely-tested file (Phase 8 added `course.ts` → `@/lib/reminders/sweep` → `dispatch.ts`) exposed it.

**How to apply:** vitest.config.mts now lists `@/generated` and `@/db` aliases BEFORE the catch-all `@` (order matters — most specific first). Keep them in sync with tsconfig `paths` whenever a new root-level alias is added.

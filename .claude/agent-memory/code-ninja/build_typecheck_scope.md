---
name: build-typecheck-scope
description: next build type-checks scripts/ and .test files (tsconfig includes **/*.ts, no ignoreBuildErrors); npm run lint only covers src/.
metadata:
  type: project
---

`tsconfig.json` `include` is `["**/*.ts","**/*.tsx", ...]` (excludes only node_modules) and `next.config` does NOT set `typescript.ignoreBuildErrors`.

**Why:** This means `npm run build` runs a full type-check across the WHOLE repo — including `scripts/*.ts` and every `*.test.ts`/`*.test.tsx`. A type error in a dev/ops script or a test file will fail the production build, even though `npm run lint` (which is just `eslint src/`) would never surface it.

**How to apply:** When a change alters a shared type (e.g. a Prisma enum), fix the fallout in `scripts/` too, not just `src/`. Use `npx tsc --noEmit -p tsconfig.json` to enumerate the full blast radius fast before running the slower `npm run build`. Test-file type errors also block the build, so they can't always be deferred to bug-hunter. Prettier is enforced separately (`npm run format:check` over `src/**`); perl/sed bulk edits often need a follow-up `prettier --write`.

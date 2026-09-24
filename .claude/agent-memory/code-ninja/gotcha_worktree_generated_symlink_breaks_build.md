---
name: gotcha-worktree-generated-symlink-breaks-build
description: Worktree build traps — the generated/ symlink makes `next build` fail (run prisma generate instead), and a next/font/google Turbopack error may be environmental: prove it on the unmodified base first
metadata:
  type: project
---

[[gotcha_worktree_needs_node_modules_and_generated]] says to symlink `generated`
from the main checkout so vitest can resolve `@/generated/prisma/client`. That
works for vitest and tsc but **breaks `npm run build`**:

```
Symlink [project]/generated/prisma/enums.ts is invalid, it points out of the filesystem root
Module not found ... ./db/index.ts
```

Turbopack resolves the project root to the worktree and refuses a symlink that
escapes it. The import trace blames `db/index.ts` and a random page, which reads
like a code error rather than a filesystem one.

**How to apply:** if the task ends in a build (it usually does — Rule 21), do a
real `npm ci` in the worktree and then

```bash
rm generated && npx prisma generate --schema prisma
```

so `generated/` is a real directory. `/generated/prisma` is gitignored, so the
real directory stays invisible to git — unlike the symlink, which shows up as
untracked. `npx prisma generate` takes <1s once node_modules is real.

Two more worktree-isolation constraints this harness enforces, which cost
round-trips: a Bash command it cannot statically prove is git-free is refused —
that rules out `$(git diff --name-only)` command substitution, `xargs -a`, and
heredocs feeding `cat > file`. Use the Write tool for new files and a plain glob
for prettier (`npx prettier --write "src/**/*.{ts,tsx}"`).

**A real `npm ci` + `prisma generate` still may not get you a green build.** On
2026-09-24 a fresh worktree (`npm ci --allow-remote=all`, real `generated/`)
failed `npm run build` with 16 copies of

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
```

traced to `src/app/layout.tsx` and `(marketing)/layout.tsx`. It is NOT a code
fault and NOT the `generated/` trap: it reproduces on a detached checkout of the
unmodified `dev` tip in the same worktree, fonts.googleapis.com answers 200, and
pinning `turbopack: { root: __dirname }` does not help.

**How to apply:** before spending time on a Turbopack `next/font/google` build
error, detach onto the base commit and build again. If it fails there too, the
build is unverifiable in that environment — report that honestly instead of
hunting it. Everything else (typecheck, eslint, prettier, the sharded vitest
suite) still runs normally.

Also: `npx prettier` cannot parse `.prisma` (no plugin resolved from the CLI) —
`npx prisma format --schema prisma` is the formatter, and lint-staged already
runs it on staged schemas.

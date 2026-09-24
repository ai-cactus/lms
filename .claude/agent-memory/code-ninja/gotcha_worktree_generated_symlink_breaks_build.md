---
name: gotcha-worktree-generated-symlink-breaks-build
description: The generated/ symlink that makes vitest work in a worktree makes `next build` fail — Turbopack rejects a symlink pointing outside the project root; run prisma generate instead
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

Also: `npx prettier` cannot parse `.prisma` (no plugin resolved from the CLI) —
`npx prisma format --schema prisma` is the formatter, and lint-staged already
runs it on staged schemas.

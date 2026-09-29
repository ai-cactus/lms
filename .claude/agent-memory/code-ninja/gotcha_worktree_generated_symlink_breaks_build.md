---
name: gotcha-worktree-generated-symlink-breaks-build
description: Worktree build traps — the generated/ symlink makes `next build` fail (run prisma generate instead); how to prove a build is Google-Fonts-free (not unshare -rn)
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

**Proving a build needs no Google Fonts (TOOL-26, 2026-09-29).** Every font is
`next/font/local` now, so the old `Can't resolve
'@vercel/turbopack-next/internal/font/google/font'` failure cannot recur. Do NOT
prove "offline" with `unshare -rn` — Turbopack's PostCSS worker then dies
("node process exited before we could connect to it"), even with `lo` up. Use a
`NODE_OPTIONS=--require` preload that makes `dns.lookup` fail for
`fonts.(googleapis|gstatic).com` and logs each attempt; a green build with an
empty log is the proof. The harness refuses `NODE_OPTIONS=$VAR` inline — put it
in a script file.

Font payload: Inter/JetBrains Mono/Geist are Google's latin + latin-ext subsets,
two `next/font/local` faces each (see `src/app/fonts/README.md`). Check preloads
in `.next/server/app/<page>.html` (`rel="preload"`); the `.p.` in a media file
name marks a preloaded face.

Also: `npx prettier` cannot parse `.prisma` (no plugin resolved from the CLI) —
`npx prisma format --schema prisma` is the formatter, and lint-staged already
runs it on staged schemas.

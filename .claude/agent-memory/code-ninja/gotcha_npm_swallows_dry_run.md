---
name: gotcha-npm-swallows-dry-run
description: npm silently eats `--dry-run` when the `--` separator is omitted from `npm run script`, which is dangerous now that scripts/ execute by default
metadata:
  type: feedback
---

`npm run <script> <args> --dry-run` (no `--` separator) does NOT forward
`--dry-run`. `--dry-run` is a real npm CLI flag, so npm consumes it and only
records it as `process.env.npm_config_dry_run=true`. Verified on npm 12.0.1.

By contrast, an *unrecognised* dash-flag (e.g. `--keep-files`) makes npm exit 1 —
loud and safe. `--dry-run` is the one that fails silently.

**Why:** every runnable script in `scripts/` now uses a single execution
convention — **absence of `--dry-run` EXECUTES**, `--dry-run` previews. There is
no `--apply`, no `--yes`, no `CONFIRM_*` env gate (all removed 2026-08-08). Under
that convention a swallowed `--dry-run` silently turns an intended preview into a
real, possibly destructive run. Under the *old* dry-run-by-default convention the
same npm behaviour was harmless, so this trap is new.

**How to apply:** `scripts/run.ts` carries a "DRY-RUN RESCUE" block that reads
`npm_config_dry_run` and re-injects the flag (erring toward a preview is always
the safe direction) — do not delete it. Always prefer
`npm run script -- <env> <file> --dry-run` when writing docs or runbooks. If you
add a new gate flag to a script, remember `--dry-run` is the ONLY blessed one;
see [[project_offline_migrations]] for the sibling "verify before you trust the
run" habit around destructive DB work.

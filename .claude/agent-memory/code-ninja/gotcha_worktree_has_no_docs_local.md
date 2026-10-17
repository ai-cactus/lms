---
name: gotcha-worktree-has-no-docs-local
description: docs/local/ (OPEN-ISSUES.md tracker) is gitignored, so a git worktree has none; the orchestrator edits it in the main checkout
metadata:
  type: project
---

`docs/local/` is gitignored (`.gitignore` `docs/local`), so the open-issues tracker `docs/local/OPEN-ISSUES.md` exists only in the main checkout, never in a `lms-wt/*` worktree.

**Why:** on RISK-19 (2026-10-17) the task asked for a tracker update from a worktree; the orchestrator ruled: don't create `docs/local` in the worktree, return 2–3 lines of tracker wording in the report instead.

**How to apply:** when working in a worktree and told to update OPEN-ISSUES.md, don't touch the main checkout or create the dir; hand the wording back. See [[gotcha-shared-worktree-agents-autostash]].

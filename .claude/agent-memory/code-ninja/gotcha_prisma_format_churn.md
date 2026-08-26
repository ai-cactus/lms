---
name: prisma-format-churn
description: lint-staged now runs `prisma format` on staged .prisma files, so schema files ARE canonical — hand-align new fields to match or the hook rewrites them under you
metadata:
  type: feedback
---

Do not run `npx prisma format` manually — but be aware the pre-commit hook now does it for you: lint-staged has a `prisma/**/*.prisma` → `prisma format` task, so anything you stage is reformatted before the commit lands. Verify your own edit with `npx prisma validate` (no DB needed, reformats nothing) and hand-align the one model you touched.

**Why:** this used to be a pure hazard — the committed `prisma/*.prisma` files were NOT in canonical form and `.prisma` was outside lint-staged, so one `prisma format` run turned a 1-field addition into a 123-line whitespace diff across `auth.prisma`, `course.prisma` and `organization.prisma`. Since the hook was added, the files have converged on canonical form: adding `pendingAssignment Json?` to `course.prisma` (2026-08-26) went through the hook and produced a clean 5-line diff, no churn in any other file.

**How to apply:** align new fields by hand (pad the name and type columns to the model's widest entries) so the hook's rewrite is a no-op and the diff stays reviewable. If a commit ever comes back with unexpected schema churn, that is the hook re-canonicalising drift someone introduced — inspect `git show --stat` before pushing. Related: [[migrate-dev-destructive-diff]], [[migrate-dev-hnsw-drift]], [[offline-migrations]].

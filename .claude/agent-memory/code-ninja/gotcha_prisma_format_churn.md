---
name: prisma-format-churn
description: Never run `npx prisma format` here — it reformats every prisma/*.prisma file, burying a one-field change in hundreds of whitespace lines
metadata:
  type: feedback
---

Do NOT run `npx prisma format` in this repo. Hand-align new schema fields instead, then verify with `npx prisma validate` (which needs no DB and reformats nothing).

**Why:** the committed `prisma/*.prisma` files are not in prisma-format canonical form, and `.prisma` is absent from lint-staged (only `src/**/*.{ts,tsx,css,json}` is covered), so nothing keeps them aligned. One `prisma format` run rewrote `auth.prisma`, `course.prisma` and `organization.prisma` wholesale — a 1-field addition became a 123-line diff, drowning the real change in whitespace noise.

**How to apply:** adding a field whose name is longer than the model's current widest one *does* force a re-alignment of that model's block; align that one model by hand (pad the name column and the type column to the new widest entries) and leave every other model and file untouched. Related: [[migrate-dev-destructive-diff]], [[migrate-dev-hnsw-drift]].

---
name: required-column-needs-its-writer-same-pr
description: A NOT NULL column with no writer is not shippable — it breaks every create path at runtime and reddens tsc; split schema/code PRs must keep the column nullable until the writes land
metadata:
  type: feedback
---

A **schema-only PR cannot add a required (`NOT NULL`, no default) column** to a table the app inserts into. Adding one and deferring the writes to a later PR fails twice:

1. **Runtime:** every `prisma.<model>.create()` omits it, so the insert throws a NOT NULL violation the moment the migration deploys. Course and document creation would be dead in production between PR A and PR B.
2. **Typecheck:** Prisma generates the field as required in `<Model>UncheckedCreateInput`, so `tsc --noEmit` goes red at every create site. Vitest does **not** catch this (it never typechecks — the suite stayed 239/4618 green while `tsc` had 15 errors), but `next build` does, per [[build_typecheck_scope]].

**Why:** proven on Phase 6 PR A (2026-09-16), which specified `organization_id` on `courses`/`documents` as `SET NOT NULL` **and** "no application-code changes". Those two requirements are mutually exclusive. 15 errors across 9 files: `src/app/actions/course.ts` (x2), `documents.ts`, `video-course.ts`, `src/lib/jobs/index.ts`, `prisma/seed.ts` (x3), `scripts/seed-qa-orgs.ts` (x3), `seed-courses.ts` (x2), `seed-test-user.ts`, `verify-compliance.ts`.

**How to apply:** when a plan splits "add the column" from "populate the column" across PRs, land the column **nullable** in the schema PR — backfill, FK and indexes included — and put the `SET NOT NULL` in a third migration alongside the writes. The backfill (the genuinely irreparable step) still lands early and is still verifiable, which is normally the whole reason for the split; only the constraint waits. Flag the conflict rather than silently picking, and never "solve" it by declaring the Prisma field `String?` while the DB column is `NOT NULL` — that just moves the explosion to runtime.

**The resolved pattern (Phase 6, PR A, 2026-09-16 — founder-approved):** expand → write → contract.
- **PR A** adds the column **nullable**, backfills it, adds the FK and indexes. Header comment states the nullability is a migration artifact, names the PR-B migration that will carry the constraint, and says explicitly that the domain does NOT permit a null — so nobody later reads `String?` as "optional".
- **PR B** adds the writers and the reads, then a third migration with `SET NOT NULL`.

**Topology caveat for the contract step:** bundling the writers and `SET NOT NULL` in one PR is safe *only* on this deployment topology — Docker Compose, one container per environment, stop → migrate → start (see [[deploy_topology]]). There is no rolling window in which an old instance inserts without the column while the constraint exists. If this ever becomes a rolling deploy, `SET NOT NULL` must move to a separate PR shipped after the writers have been live.

Related: [[project_offline_migrations]], [[project_migrate_dev_destructive_diff]], [[deploy_topology]], [[build_typecheck_scope]].

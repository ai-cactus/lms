---
name: e2e-specs-raw-sql-insert-courses
description: 11 e2e specs INSERT INTO courses with raw SQL, so any new NOT NULL column on courses breaks them — and CI skips e2e on feature PRs, so nothing tells you
metadata:
  type: project
---

**Eleven `tests/e2e/*.spec.ts` files build their own fixtures with raw `pg` SQL rather than Prisma**, including `INSERT INTO courses (...)`. They therefore bypass the generated client entirely: `tsc` cannot see them, vitest cannot see them, and adding a required column to `courses` (or `documents`) breaks every one of them with `null value in column "…" violates not-null constraint`.

The specs: `assign-course-invite`, `course-details-hero`, `course-publish-review-gate`, `course-role-assignment`, `course`, `facility-dashboard`, `remove-reinvite-retention`, `staff-assign-courses`, `staff-assign-multiple-courses`, `video-playback`, `worker-trainings-preview-flow`. Each seed helper has a local `orgId` in scope, so the fix is mechanical.

**Why this bites:** CI does not run Playwright on feature PRs (CLAUDE.md), so the PR merges green and the breakage only surfaces on a promotion PR days later. Phase 6 PR B hit this — the unit suite was 243/4649 green and `tsc` was clean while three e2e specs were dead.

**How to apply:** whenever a PR adds a NOT NULL column to `courses` or `documents`, `grep -rn "INSERT INTO courses\|INSERT INTO documents" tests/e2e/` in the same PR and patch every hit. Append the new column at the END of the column list and use `$<maxN+1>` so the existing placeholder numbering does not have to shift.

**Pre-existing rot found while doing this (NOT caused by the column):** `staff-assign-multiple-courses.spec.ts` is `test.describe.skip` at :339 and its fixtures still use columns that no longer exist — `courses.created_by` (real name: `created_by_org_user_id`) and `enrollments.user_id` (real name: `organization_user_id`). Un-skipping it needs that repair first. `video-playback.spec.ts` skips conditionally on a generated `.mp4` fixture (`tests/e2e/fixtures/generate-video-fixture.sh`) that is absent locally.

Related: [[gotcha_required_column_needs_its_writer_same_pr]], [[project_e2e_seed_infra]], [[gotcha_datepicker_accessible_name_is_placeholder]].

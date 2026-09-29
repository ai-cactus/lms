---
name: gotcha-retakeof-has-no-relation
description: Enrollment.retakeOf is a plain column (no @relation, no FK) — "has a retake" cannot be a Prisma where; superseded rows are a dashboard-wide rule
metadata:
  type: project
---

`Enrollment.retakeOf` is a bare `String?` — no forward relation, no back-relation, no FK, no
index. Adding `retakes Enrollment[]` needs a forward `@relation` too, and `migrate diff` then
emits `ADD CONSTRAINT enrollments_retake_of_fkey` (checked 2026-09-28), so it is NOT a
schema-only change. "Is named by another row's retakeOf" therefore can't be a where-predicate:
look the retakes up by id (`retakesOfWhere(ids)` ANDed with the scope) and filter in memory.

**Why:** `assignRetake` leaves the failed row `locked` forever. BUG-38 ruled such a row
SUPERSEDED once any retake names it: excluded from every dashboard obligation/progress/grade
figure (`withoutSuperseded` in `src/lib/dashboard/definitions.ts`), kept ONLY for First-Time
Pass Rate. A locked row with no retake still counts.

**How to apply:** any new dashboard figure goes through `withoutSuperseded(slice)` (or the
tracker's lookup). The reminder side honours it through `src/lib/reminders/eligibility.ts`
(`findSupersededIds`; `findIneligibleEnrollmentIds` = finished OR superseded OR archived): Track
A/B, the email retry pre-pass, and the cycle summary's compose AND retry all re-check through it
(BUG-44/45). `resolveOnCompletion` walks the `retakeOf` chain one hop per query (BUG-46). A
retake now carries a `dueAt` (Q-26) and no `assignmentId`, so Track A ladders it on the DEFAULT
stages — an assignment's `remindersEnabled:false` does not reach it. See
[[gotcha-sweep-test-mock-queue-coupling]] before touching the sweep.

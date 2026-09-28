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
tracker's lookup). The reminder sweep does NOT honour the rule yet — Track A keeps laddering a
superseded locked row that has a `dueAt`, and Track B's ADMIN_REASSIGN only skips when the
retake is still non-terminal. See [[gotcha-sweep-test-mock-queue-coupling]] before touching it.

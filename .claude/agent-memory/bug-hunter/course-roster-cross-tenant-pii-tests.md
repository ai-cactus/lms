---
name: course-roster-cross-tenant-pii-tests
description: Tests added for the getCourseById/getCourseForOrgView cross-tenant roster query fix — the mock-ignores-where trap and how it was worked around
metadata:
  type: project
---

Branch `fix/course-roster-cross-tenant-pii` (2026-09-14), cut from dev @ `4528660`.
Product code (uncommitted, not touched by me) added an `enrollments.where` predicate
to `getCourseById`'s and confirmed `getCourseForOrgView`'s `prisma.course.findUnique`/
`findFirst` calls, closing a leak where an adopted video course's roster spanned
every tenant. See `gotcha_course_roster_spans_tenants` (code-ninja memory) for the
product-side rationale.

**Why this needed a different test shape:** `src/app/actions/course.test.ts`'s
`mockCourseFindUnique`/`mockCourseFindFirst` **ignore the `where`/`select` argument
entirely** and just return whatever the test's `mockResolvedValue` constructed. Every
pre-existing roster test therefore only proves the IN-MEMORY narrowing
(`narrowRosterToFacilityScope`, the worker self-filter) — a query-level regression
(deleting the `enrollments.where` entirely) would not fail a single one of them. The
only way to prove the query-level half of the fix is to assert on
`mockCourseFindUnique.mock.calls[0][0].select.enrollments.where` directly.

**How to apply:** when touching `getCourseById`/`getCourseForOrgView` again, extend
the `describe('cross-tenant roster query filter — argument assertions', ...)` blocks
inside each of the two `describe` sections in `course.test.ts` rather than adding more
roster-content assertions — those already exist and won't catch a query-predicate
regression. I proved these tests meaningful by temporarily stripping the `where` from
both call sites in `course.ts`, confirming exactly the 4 new argument tests (and no
others) went red, then restoring — same red-then-green technique as
[[audit-fx-regression-patterns]].

**Other findings:**
- The removed `isCreator ? course : narrow(...)` exemption (Priority 2 in the task)
  only changes behavior for a facility-bound creator role (e.g. `nurse`) — an
  org-wide creator role (`owner`) was always going to get the full roster via
  `narrowRosterToFacilityScope`'s `null`-scope short-circuit, so that sibling test
  needed no behavior change, just a corrected comment.
- `getCourseForOrgView`'s query filter (`organizationUser: { organizationId }`, no
  own-userId OR clause) is correct as written and NOT the same gotcha as
  `getCourseById`: its access decision is role-based (`isOrgManager`), never reads
  `isEnrolled` from the roster, so there's no own-row-must-survive requirement to
  protect. Don't "fix" it to add an OR clause — that would be scope creep, not a bug.
- `TrainingDetails.tsx` derives `totalLearners`/`completedCount`/`averageScore`
  straight from `course.enrollments.length` etc. — a pure prop consumer with zero
  awareness of tenant scoping. Deliberately did NOT add a dedicated component test to
  "pin" the now-scoped numbers: the component doesn't know or care where the array
  came from, so the real regression risk lives entirely in `course.ts`, already
  covered. Would be a redundant/low-value test.
- e2e: `course-details-hero.spec.ts`, `worker-trainings-preview-flow.spec.ts`,
  `course.spec.ts` all pass unmodified against a fresh `lms_e2e` seed — the fix is a
  no-op for these single-org fixtures (the OR/org clause both admit the caller's own
  org). The seed script already produces a `multi.org@test.com` fixture "in 2 orgs"
  worth reusing if a live cross-tenant e2e is ever written for this area.

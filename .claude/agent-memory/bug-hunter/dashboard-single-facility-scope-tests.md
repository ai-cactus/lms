---
name: dashboard-single-facility-scope-tests
description: Cross-branch dashboard parity test suite (fix/dashboard-single-facility-scope) — sabotage-proof pattern, e2e HR-authored-course fixture, AVG-vs-round finding, getCourses org-pin gap (since fixed, c541c48c)
metadata:
  type: project
---

Branch `fix/dashboard-single-facility-scope` (cut from dev @ `e37375e`) fixed the
third recurrence of "single-facility org sees creator-scoped numbers, 2+
facilities sees org-scoped numbers" (see code-ninja's
`gotcha_dashboard_two_actions_one_population.md`). I wrote/fixed all the tests
the plan (`serialized-sniffing-matsumoto.md`) called for; final state: 4576
unit/integration tests green (263 files), 1 new e2e spec passing, `tsc`/eslint
clean.

**Why this note exists:** the sabotage-proof technique and the e2e seeding
pattern here are reusable for any future "shared scope seam" PR, and the
AVG-vs-round finding is a residual, permanently-untestable-at-unit-level risk
worth remembering rather than re-investigating.

**How to apply:**
- `src/app/actions/dashboard-parity.test.ts` is the durable regression guard —
  it captures EVERY `enrollment.*` call across both `getDashboardData` and
  `getGlobalDashboardData` and asserts the org pin generically (`where
  .organizationUser?.organizationId`), not a hand-listed subset. Proved this
  works by injecting a new `prisma.enrollment.count({ where: { score: { not:
  null } } })` (no org pin) into `dashboard-facility.ts`'s Promise.all,
  confirming both Tier-1 tests went red, then reverting — this is the pattern
  to reuse whenever a plan asks for a "the test that fails if scope is
  dropped" proof: add the unscoped query as a temporary sibling in the SAME
  `Promise.all`/destructure (compiles fine, TS has no `noUnusedLocals`), run
  just that test file, then `Edit` it back out and re-run to confirm green.
- 25 pre-existing failures were exactly 24 mock-gap (missing
  `orgCourseOffering.findMany` in 3 test files' `vi.mock('@/lib/prisma')`) + 1
  real literal (`course.test.ts` asserting the creator-scoped `where`, which
  WAS the bug) + 3 page.test.tsx tests with an "impossible fixture" (stubbing
  `getGlobalDashboardData` to N facilities while leaving
  `mockListAccessibleFacilities` at its default `[]` — the branch now decides
  from `listAccessibleFacilities` alone, not from `globalData.facilities`).
  All of code-ninja's classifications held up under my own verification.
- **AVG-vs-round, unresolved by design:** `getDashboardData`'s `averageGrade`
  is `Math.round(sum/n)` over fetched rows in JS;
  `getGlobalDashboardData.organisationTotals.averageGrade` is
  `Math.round(pgAvg)` over a mocked Postgres `AVG`. A unit test can only prove
  both call `Math.round` on the identical number it was handed — it CANNOT
  reproduce genuine Postgres-numeric-vs-JS-float divergence, because the mock
  supplies both sides' input by hand. I built the `.5`-boundary fixture the
  plan asked for (85/86 → 85.5 → 86 both sides) and it trivially agreed; this
  is not evidence the two are safe on read data, only that the rounding call
  itself is consistent. If this dashboard fix regresses in a way that looks
  like a 1-point average discrepancy in production, suspect this seam first —
  it needs a real-Postgres check, not another unit test.
- **e2e fixture pattern for "prove the org, not the viewer":** seed a course
  authored by an HR org-user while logging in as the OWNER
  (`seedOrgWithOneFacilityAndKnownData` in `tests/e2e/facility-dashboard.spec.ts`)
  — this is the only way an e2e assertion can distinguish "org-scoped" from
  "creator-scoped" without reading the DB mid-test. Locate summary-card VALUES
  via `page.getByText(label, {exact:true}).locator('xpath=following-sibling::p[1]')`
  — the admin dashboard's summary cards are `<p>{label}</p><p>{value}</p>` sibling
  pairs with Tailwind-bracket classes that are painful to target with CSS.
- **Since fixed (`c541c48c`):** `getCourses`' `ownCounts` groupBy now pins the
  learner with `organizationUser: { organizationId }`, the same as `adoptedCounts`.
- An unrelated, unrequested product change appeared mid-session in
  `src/components/dashboard/training/TrainingDashboard.tsx` (heading `"My
  Courses"` → `"Courses"`, same D3 rename as `MyCoursesTable.tsx` but a
  different component/page) — not made by me, no test covers it, did not
  break anything. Evidence of a concurrent agent editing the working tree
  during this session; flagged to the orchestrator rather than silently
  absorbed.

See also [[project-test-framework]].

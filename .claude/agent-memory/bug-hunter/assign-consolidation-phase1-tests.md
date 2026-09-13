---
name: assign-consolidation-phase1-tests
description: Phase 1 of the assign-surface consolidation (sink tri-state, D-F past-date rule, stale parked-deadline replay) — test patterns, mock-shape gotcha, and the CourseWizard mocking recipe used for its first-ever UI test
metadata:
  type: project
---

**Context**: `feature/assign-sink-hardening` made `upsertCourseAssignment`
(`src/lib/enrollment/assignment.ts`) return `{ id, dueAt, dueWindowDays }`
instead of a bare `string`, and treat the 5 settings columns + `stageRows` as a
real tri-state (`undefined` = leave alone, `null` = clear). See
[[assign-role-label-due-date-tests]] for the immediately-preceding phase this
built on.

**Mock-shape gotcha, hit in 3 separate test files**: any test whose
`courseAssignment.update`/`.create` mock has no `mockResolvedValue` at all now
breaks silently — `upsertCourseAssignment` destructures `{ id }` (or the caller
does `.id`) off the awaited call, and an un-mocked `vi.fn()` resolves
`undefined`, so the destructure throws `Cannot destructure property 'id' of
undefined`. Fixed in `course.assign-course-to-users.test.ts` (added a
per-test `mockResolvedValue`) and `enrollment.assign-course-to-roles.test.ts`
(switched the *file's* default to `mockImplementation(({ where }) => ({ id:
where.id, dueAt: null, dueWindowDays: null }))` so every existing-row test gets
a correct id without per-test boilerplate). Check this first in any future
sink-signature change — it silently breaks tests that only assert on the
mock's *call args*, not its return value.

**Fixture-date rot (the exact class CLAUDE.md's D-F section warned about)**:
`enrollment.assign-course-to-roles.test.ts`'s deadline-precedence test used a
literal `dueDate: '2026-03-01'` with no fake timers; once "today" passed that
date, the new D-F past-deadline-refusal logic correctly started refusing it.
Fixed by freezing the clock (`vi.setSystemTime('2026-01-01')`) for that
describe block rather than editing the fixture forward — the next person to
hit this will have the same problem with whatever date is chosen, so freeze
early. Same fix needed in `course.deferred-assignment.test.ts`'s roles-mode
replay test (parked date was `2026-09-01`, "today" was `2026-09-13`).

**`course.deferred-assignment.test.ts`'s prisma mock only defined `course`** —
no `courseAssignment` at all. Once `publishCourse` started calling the new
`findAssignmentDueAt` (which does `prisma.courseAssignment.findFirst`) as part
of the stale-parked-deadline check, that lookup threw into the replay's
catch-all and every affected test read `assignmentFailed: true` instead of
`false`. Needed `courseAssignment: { findFirst: mockAssignmentFindFirst }`
added to the mock, defaulted to `null` in `beforeEach`.

**Red-then-green discipline paid off** for the reminder-stage inversion: the
two pre-existing tests literally asserted `GRACE_SOFT_ESCALATION`/
`HARD_ESCALATION` rows equal `defaultStageRows()`' rows — i.e. they pinned the
bug. Inverting them to "never emits these stages at all" and stashing the
product fix confirmed both flip correctly.

**CourseWizard had zero unit tests before this phase** (like
`AssignPublishClient` before it — see [[assign-role-label-due-date-tests]]).
New file: `CourseWizard.assignment-notice.test.tsx`, covering the
`assignmentDeadlineExpired` advisory (warning `Alert`, `role="alert"`) vs.
`assignmentFailed` (plain error banner) — the two are mutually exclusive and
must render distinctly. The component is ~900 lines with 7 real step
components, 3 modals and half a dozen server-action imports, so the only
tractable approach was mocking literally everything except CourseWizard's own
state machine: every `./steps/*` component becomes a stub with one button per
field it would collect, `ConfirmPublishModal`/`ReviewWarningsModal`/
`CourseSuccessModal` become one-button stubs, and every `@/app/actions/*`
import gets `vi.mock`'d (even ones never invoked in the test's path — several
are `'use server'` files that can carry import-time side effects, and
`ConfirmPublishModal`'s own `getCourses`/`useSession` deps disappear for free
once the modal itself is mocked rather than driven for real).

**Multi-field-onChange staleness trap**: `renderStep()`'s `onChange` for
`Step3Details`/`Step4Quiz`/`Step7Assign` is
`(field, val) => setFormData({ ...formData, [field]: val })` — NOT a
functional updater. Calling it twice synchronously in one handler (e.g. a mock
component firing `onChange('title', …); onChange('description', …);` in one
`onClick`) makes the second call silently clobber the first, since both close
over the same stale `formData` from that render. Each mocked step therefore
exposes ONE BUTTON PER FIELD, and the test clicks them one at a time so each
click gets its own React commit before the next fires. This mirrors a latent
footgun in the real steps too (worth flagging if a future step ever needs to
set two fields from one interaction).

**Full flow driven per test**: category → upload → details → quiz → generate
→ quizReview → assign → Publish Course → Confirm Publish → (reviewGate)
Publish Anyway. `analyzeStoredDocument` fires for real (mocked to a no-op
resolve) on the upload→details transition — the only async hop before the
final step — so that one click needs `findBy` instead of `getBy` to avoid a
race.

**Prisma tri-state semantics reconfirmed under a NEW angle**: `targetRoles`
and `facilityScope` still have opposite `null` meanings post-Phase-1 (targetRoles:
null clears; facilityScope: null means org-wide) — new file
`assignment.settings-tri-state.test.ts` has a dedicated test passing BOTH
`null` in the same call and asserting opposite effects, specifically to catch
a future refactor that tries to unify the two tri-state helpers.

**Full e2e run** (all specs the orchestrator listed): `course-publish-review-gate.spec.ts`
(2/2), `staff-assign-courses.spec.ts` (3/3), `staff-assign-multiple-courses.spec.ts`
(1 skipped — pre-existing `describe.skip` unrelated to this phase, its own
comment says "un-skip once the seed is ported"; note its test title/body still
reference the removed `preserve` mode by name, worth a follow-up cleanup
whenever that skip is lifted), `reminders.spec.ts` (8/8, 1 pre-existing skip —
`PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` unset), `course-role-assignment.spec.ts`
(1/1), `assign-course-invite.spec.ts` (1/1). All green, no reseed-between-runs
issues hit this time.

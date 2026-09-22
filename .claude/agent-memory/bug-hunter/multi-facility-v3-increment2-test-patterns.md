---
name: multi-facility-v3-increment2-test-patterns
description: Test patterns and 3 real pre-existing e2e regressions found/fixed while testing multi-facility v3 increment 2 (facility scope, fork-course, global dashboard, staff facility, courses tabs, bulk upload)
metadata:
  type: project
---

Wrote 9 new unit/component test files (scope.test.ts, member-facility.test.ts,
metrics.test.ts, fork-course.test.ts, dashboard-facility.test.ts,
course.assign-retake.test.ts [previously ZERO coverage for `assignRetake`],
CoursesListClient.test.tsx, AddFacilityModal.test.tsx,
ChangeFacilityModal.test.tsx) + extended 7 existing action test files
(organization/staff/documents/course/course.assign-course-to-users/
sweep/enrollment-create) for facility stamping, RBAC gates, tenant isolation.
Full suite went 147→156 files, 2217→2407 tests, all green. 3 new + 3 extended
e2e specs, all green after fixing real staleness (below).

**Three genuine pre-existing e2e regressions found and fixed** (not caused by
my new tests — these broke because Phase A/C shipped intentional behavior
changes that nobody updated the old e2e assertions for; confirmed via `git
diff dev` that each was a deliberate product change, not a bug):
1. `settings-page.spec.ts`'s Facility-tab persistence test selected the
   `'Outpatient clinic'` option — FacilityTab.tsx's locally-defined type list
   (which had that value) was replaced by the new shared
   `FACILITY_TYPE_OPTIONS` list (`src/lib/facility/facility-type-options.ts`),
   which does NOT include it. Fixed to select `'Private Practice / Group
   Practice'` instead.
2. `documents.spec.ts`'s `.doc`-rejection test targeted dialog name `'Upload
   Document'` and error text `'Only PDF and DOCX files are allowed.'` —
   `upload-modal.tsx`'s multi-file rewrite renamed the dialog to `'Upload
   documents'` (plural) and changed the client-side rejection copy to
   `'Skipped 1 file(s): <name> (only PDF and DOCX are allowed)'`. Also the
   submit button reads `"Upload 0 files"` / `"Upload N files"` now, never a
   bare `"Upload"`.
3. Grepped all of `tests/e2e/*.spec.ts` for both stale strings after fixing —
   confirmed no other spec references them, so this is a complete fix, not a
   partial patch.

**`getCourses()` (src/app/actions/course.ts) is org-wide for managers.** For
`isAdminRole` + `course.read` it filters `creator: { organizationId }`. It is
creator-scoped (`createdByOrgUserId`) only for non-managers. Both paths add
anything in `org_course_offerings` for the org.

**Both Global View tables render one row per facility with the same
drill-down label**, `View dashboard for <name>` (`PriorityRisksTable`,
`FacilitiesOverviewTable`). An unscoped
`getByRole('row', {name: facilityName})` is a strict-mode violation across
both tables, and so is the link. Scope to a `section` filtered by
`getByRole('heading', {name: 'Facilities Overview'})` (or `'Priority Risks...'`)
first.

**`ChangeFacilityModal`'s confirm-step "Cancel" does NOT close the dialog** —
it only calls `setStep('select')`, returning to the facility-picker step. Only
the select-step's "Cancel" calls `onClose`. Don't assume "Cancel" always
dismisses a two-step confirm dialog; check the component's actual handler.

**ResizeObserver must be stubbed for any component test that mounts Radix
`RadioGroup`** (`useSize` hook throws `ReferenceError: ResizeObserver is not
defined` in jsdom) — same class of gap as the already-known "Radix Select
untested in this repo" caution, now confirmed to also hit RadioGroup.
Minimal fix: `vi.stubGlobal('ResizeObserver', class { observe(){} unobserve(){}
disconnect(){} })` at the top of the test file.

**A native `<input type="email">`'s browser-level constraint validation beats
React Hook Form's `pattern` validation in jsdom** — clicking submit on a
malformed email never fires the `submit` event at all (blocked client-side),
so RHF's custom pattern-mismatch message never renders and `handleSubmit`
never runs. Don't assert on the RHF error text for a `type="email"` field;
assert only that the mutation action was never called.

**`$transaction` mock needs BOTH array-form and callback-form support** when
a test file's existing suite uses array-form (`$transaction([...])`, e.g.
`removeStaff`) but you're adding coverage for an action using callback-form
(`$transaction(async (tx) => ...)`, e.g. `setStaffFacilities`) in the SAME
mocked file — one `vi.fn()` implementation must branch on
`typeof arg === 'function'`.

Document bulk-upload **cannot be live-tested end-to-end** in this sandbox —
same root cause as the existing single-file gap documented at the top of
`documents.spec.ts` (PHI scan requires real Vertex AI creds, always fails
closed without them). Wrote a UI-mechanics-only test (multi-select, per-file
remove, category, button label/enable state) instead of a real submit+persist
assertion.

Related: [[org-facility-split-test-patterns]], [[documents-hub-rbac-gate-tests]],
[[rbac-e2e-organizationuser-fixture-port]].

---
name: course-wizard-9step-redesign-tests
description: 7→9 step course wizard certification (branch multi-facility) — new e2e test files, how to drive Step2Modules/Step3Audience without live AI, a real clinical_director/Assign-Course RBAC bug found, and test-staleness fixes vs. product bugs
metadata:
  type: project
---

**Context:** certified the course-creation-wizard redesign wave (7→9 steps: Step2Modules
multi-module builder, Step3Audience, GenerationController multi-job generation, Step9AssignPublish
role tabs) plus staff-profile AssignCoursesModal, on branch `multi-facility`, everything
uncommitted. Full breakdown: unit/integration 205 files/3127 tests green (single run, no flake);
lint/format/tsc/build all clean; e2e initially 134 passed/13 failed/3 skipped, ending at 149
passed/0 failed/1 flaky-but-passed-on-rerun/3 skipped after fixture cleanup ([[full-e2e-suite-serial-flakiness]])
and test fixes.

**Driving the wizard past Step 2 without Vertex AI credentials:**
- Deep-link `/dashboard/courses/create?documentId=<seeded-doc-id>` — `CourseWizard.tsx` seeds
  Step 2's first module's `attachment` directly from the query param, bypassing the real
  `uploadDocument` PHI-scan call entirely (which needs live Vertex AI and always fails closed in
  this environment — same reason `documents.spec.ts` never submits a real upload). The seeded doc
  is `prisma/seed.ts`'s `DOC_ID = '33333333-3333-4333-8333-333333333331'`
  (`e2e-compliance-policy.pdf`, owned by `admin@test.com`).
- Clicking "Next Step" from Step 2 fires `analyzeStoredDocument` (the deprecated v1 AI pipeline)
  against Vertex AI — this **fails fast** (no default credentials → immediate throw, not a hang)
  and `CourseWizard.tsx`'s `handleNext` advances to Step 3 in its `finally` block regardless of the
  call's outcome. So driving through Steps 1-5 (Category → Modules → Audience → Details → Quiz) is
  fully drivable end-to-end without mocking anything; the AI-dependent boundary is genuinely at
  Step 6 (`GenerationController`/`startModuleGenerationJobs`), matching the existing
  `course.spec.ts` ENG-024 precedent of stopping at Step 2.
- Step 3's default `audience: 'general'` is already Next-valid; exercising "Specific Roles" +
  role-checkbox selection is worthwhile since it's new this wave (`isAudienceSelectionValid`).
- Step 4/5 need manual fills (title/description/3 objectives/quiz title) since the AI auto-fill
  never succeeds — `INITIAL_FORM_DATA`'s empty strings block Next otherwise.
- New file: `tests/e2e/course-wizard-module-builder.spec.ts`.

**AssignCoursesModal (new staff-profile "Assign Course" flow, unrelated to the wizard's own
Step9AssignPublish) needs no AI at all** — it only assigns already-published courses to an
existing staff member via `assignCoursesToUser`/`getCourses()`. Fully e2e-drivable. New file:
`tests/e2e/staff-assign-courses.spec.ts` (3 tests: video/reading tab assign + persistence, tab
filtering, supervisor RBAC gate). Needs an active `subscriptions` row on the seeded org — same
billing-gate requirement as `assign-course-invite.spec.ts`/`worker-billing-gate.spec.ts`.
`getStaffDetails`/staff-profile URL is keyed by `organization_users.id`.

**Real product bug found (reported to code-ninja, not fixed):** `rbac-staff-view-only.spec.ts`
("Finance / Clinical Director are view-only on staff") explicitly asserts clinical_director never
sees "Assign Course" on a staff profile. `StaffProfileClient.tsx`'s new `canAssignCourses` gate
uses the coarse `can(role, 'assignment.create')` — and `clinicalDirector`'s permission list in
`src/lib/rbac/permissions.ts` (unmodified this session, pre-existing) already grants
`assignment.create` for an unrelated purpose ("assigns clinical training paths"). The new button
surfaces for clinical_director as a direct, unintended side effect, violating this pre-existing
spec's stated invariant. Finance (no `assignment.create`) is unaffected — only clinical_director.
Needs a narrower permission or an explicit RBAC-matrix decision, not a bug-hunter call.

**Test-staleness fixes made (NOT product bugs — intentional wave changes the specs hadn't caught
up to):**
- `course.spec.ts` supervisor kebab test: `CoursesListClient.tsx`'s `buildRowActions` changed from
  `canReadDocuments && course.sourceDocumentId` (hidden when no source doc) to `canReadDocuments`
  alone with the item `disabled` instead — so a read-only supervisor now DOES see the kebab
  trigger (one disabled "View Source Document" item), where before there was no trigger at all.
- `course.spec.ts` ENG-024: Step 2 is no longer a document-checkbox picker; rewrote to describe/
  drive the actual Step2Modules module-builder form.
- `facility-dashboard.spec.ts`: `FacilityScopeSwitcher` was rebuilt around a new
  `FacilityScopePalette` popover — its "All facilities" chip (`applyAllFacilities`) applies AND
  closes immediately; there is no separate "View Global Dashboard" confirm button the old test
  assumed.
- `documents-hub-rbac-gate.spec.ts`: Upload button relabeled "Upload New" → "Upload file"
  (`upload-section.tsx`), intentional this session.
- `staff-change-facility.spec.ts`: two independent issues — (1) `ChangeFacilityModal`'s dialog
  heading and its confirm button are BOTH literally "Change facility" (pre-existing, unrelated to
  this wave's cosmetic-only diff on that file — a latent ambiguous-locator bug that just hadn't
  been hit before), fixed by scoping to `getByRole('heading', ...)`; (2) `StaffListClient.tsx` was
  substantially rewritten this session and now omits the row-actions kebab trigger ENTIRELY when a
  role has zero available actions (documented in its own "Action cell" code comment) rather than
  rendering a kebab with a hidden item — supervisor (no `user.edit`/`user.delete`) now has no
  kebab at all on a staff row, not a kebab with a hidden "Change Facility" item.

See [[full-e2e-suite-serial-flakiness]] for the fixture-pollution root cause and reset recipe that
explained the other 9 of the original 13 failures.

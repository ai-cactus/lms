---
name: courses-list-figma-redesign-tests
description: CoursesListClient Figma redesign test patterns — accessible tab names with Badge counts, sourceDocumentId requires seeding real document lineage, per-tab empty state vs search-miss distinction
metadata:
  type: project
---

`src/components/dashboard/courses/CoursesListClient.tsx` was redesigned (833 → ~440 lines,
extracted `PendingGenerationBanner`, `CourseRenameModal`, `CoursesTableFooter` (exports pure
`buildPaginationRange`), `CoursesEmptyState`). Key non-obvious points for future work here:

**Tab accessible names changed shape, not just words — and have moved again.** The tab label and
its count are separate nodes (`Video Courses{' '}<span>{count}</span>`), so the accessible name is
now `"Video Courses 1"` / `"Reading Courses 2"` (as of the 2026-09-22 status/thumbnail pass —
before that it was briefly `"Video 1"` / `"Reading Course 2"`). Check `tests/e2e/course.spec.ts`
and the `TabsTrigger` text in `CoursesListClient.tsx` directly before trusting either historical
label in a new spec — this has changed twice. The persisted DB discriminant for reading courses is
still `'text'` — only the label/tab id changed (`'reading'`/`'slides'` tab maps to `type: 'text'`).

**`sourceDocumentId` is a derived join, not a column** — `getCourses()` in
`src/app/actions/course.ts` resolves it from `course.versions?.[0]?.documentVersion.documentId`
(a `CourseVersion` → `DocumentVersion` → `Document` chain), ordered `version desc`, `take: 1`.
An e2e-seeded course with no `course_versions` row always has `sourceDocumentId: null`, so "View
Source Document" never renders regardless of role — to test that gated item, seed a `documents`
row, a `document_versions` row, and a `course_versions` row linking them (see
`seedCourseTabsFixture` in `tests/e2e/course.spec.ts`). Clean up in FK order: courses first
(cascades `course_versions` via `Course`'s `onDelete: Cascade`), then `document_versions`, then
`documents`.

**Empty state is now per-tab and does NOT hide the widget** — the old empty state hid tabs +
search entirely; the redesign (`CoursesEmptyState`) only replaces the table+footer when the
*active* tab has zero courses AND the search box is blank. This is the single highest regression
risk in the redesign — a test that only checks "empty panel appears" without also asserting the
tabs/counts/search are still in the DOM would pass even if a regression re-hid the whole widget.
Distinct and must not be conflated: a **search that matches nothing** on a non-empty tab still
renders the OLD `EmptyTableState` "No courses found." row *inside* the table chrome (colSpan is
now 4, was more before column removal) — never the illustrated panel.

**Row kebab lost `Duplicate` and all separators.** Gated items are now exactly: Assign to staff
(`assignment.create`), View Source Document (`document.read` + `sourceDocumentId` truthy), Rename
(`course.edit`), Delete (`course.delete`). Any lingering "Duplicate" assertion in older specs is
now vacuous (the concept doesn't exist) and should be deleted, not just re-targeted.

**Header lost the "Prebuilt Courses" button entirely** (`PrebuiltCourseCatalog.tsx` has
since been deleted) — don't add regression
coverage for it; a negative assertion on it is meaningless now (true for every role).

`buildPaginationRange` (exported from `CoursesTableFooter.tsx`) was previously untested anywhere
in the repo — added direct unit coverage of its ellipsis-windowing logic in
`CoursesListClient.test.tsx` since no dedicated `CoursesTableFooter.test.tsx` exists.

See also [[e2e-local-auth-url-env-trap]]. E2E runs locally via `npm run e2e:local` (production
build, `lms_e2e` DB, seed on every run).

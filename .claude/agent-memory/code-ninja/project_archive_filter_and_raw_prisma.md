---
name: archive-filter-and-raw-prisma
description: Course/Document reads are archive-filtered by a client extension in db/index.ts; 8 named files must use the un-extended rawPrisma, and NO nested position (where, include or select) is covered
metadata:
  type: project
---

Since Phase 6 PR B (2026-09-16), deleting a course or a document **archives** it (`archivedAt`) instead of destroying it (founder Q24), and courses/documents are owned by `organizationId` rather than joined through the author's membership (Q25).

**The filter is a Prisma query extension in `db/index.ts`**, applied to `findFirst`, `findFirstOrThrow`, `findMany`, `findUnique`, `findUniqueOrThrow`, `count`, `aggregate`, `groupBy` on Course and Document. Deliberately **not** on writes — rerouting `.delete()` to an archive `.update()` would make the two archive writes' intent invisible at the call site. The merge helper is `db/archive-filter.ts` (pure, unit-tested; the `...args.where` spread is load-bearing — dropping it would discard every caller's tenancy predicate).

**Eight files import `rawPrisma` and MUST keep doing so** (the seven below plus `src/lib/audit-reports/catalogue-scope.ts`, the shared auditor predicate — see [[gotcha_auditor_catalogue_lockstep]]). Each is guarded by a test that gives the two clients different spies, so a swap fails loudly rather than looking equivalent:
- `src/lib/queue/video-sweep-worker.ts` — the storage reference set; filtered, the sweeper deletes an archived course's video.
- `src/lib/queue/auditor-export-worker.ts` — 4 Course queries; filtered, the compliance export is silently incomplete.
- `src/app/actions/auditor.ts` + `src/app/api/auditor/export/start/route.ts` — the auditor's ON-SCREEN catalogue, kept in step with the export above. These widen the Course ROW only; the `auditPack.*` gates, `orgCourseWhere` and every facility narrowing around them are untouched, and a test pins that a supervisor keeps facility scope on staff/enrollments/rollups.
- `src/app/actions/system-admin.ts` — the delete preview AND `deleteUserWithRelations`' whole `$transaction` (its `deleteMany`s destroy archived rows regardless, so the `findMany` deriving `courseIds` must match).
- `src/lib/learn/get-learn-payload.ts` — maintainer ruling: archiving retires a course for new assignment, it does not erase a learner's enrolment or certificate.
- `src/app/actions/course.ts::getCourseById` (added 2026-09-17, staging QA ISSUE-3) — the ENTRY POINT to the above. `/worker/courses/[id]` 404'd on an archived course, so `get-learn-payload`'s carve-out was unreachable in the product. It reads unfiltered, selects `archivedAt` **alongside** `courseDetailSelect` (never *into* it — the field stays out of `CourseWithRelations` and the UI contract), and then refuses an archived course to anyone who is not enrolled: `if (course.archivedAt && !isEnrolled) throw notFound`. The rule is keyed on WHY access was granted, not on the caller or the call site, which is why it beat the two alternatives considered (an `includeArchived` flag the next admin surface could pass, or a duplicate read alongside the gate). Note this deliberately drops authorship and the org-manager review right for an archived course — only `getCourses` and the other LISTS keep it invisible, and those stay on the filtered client.

**Nested traversal, one real hole closed:** `getCourses`' adopted-offering read now states `where: { organizationId, course: { archivedAt: null } }`, and the source-document lineage select pulls `documentVersion.document.archivedAt` so `sourceDocumentIdOf` can report an archived source as "no source document" (which is the state the row-actions menu already renders disabled). Both are relation predicates/fields on the PARENT read — the shape a query extension cannot supply for you.

**The extension cannot reach a nested `where` either — and that is where it bit a SECOND time (2026-09-17, `fix/dashboard-archive-leak`).** `prisma.course.count({ where: courseWhere })` is filtered; `prisma.enrollment.groupBy({ where: { course: courseWhere } })` is not. So one dashboard screen showed Total Courses excluding an archived course while Total Staff Assigned, Average Grade, course performance and the whole Status Tracker still counted its enrolments. Parity tests could never see it (both dashboard actions were wrong identically); the property that fails is INTERNAL — within one action, the course-derived and enrolment-derived figures must describe the same population.

The fix shape, in `src/lib/dashboard/scope.ts`, is TWO predicates and both are load-bearing:
- `enrollmentWhere` carries `course: { archivedAt: null }` — this is what fixes the ~15 per-facility aggregates in `dashboard-facility.ts` that only spread it, and what stops a NEW aggregate omitting it.
- `liveCourseWhere` (= `courseWhere` + `archivedAt: null`) exists because a call site that restates `course:` to narrow to the org catalogue **SHADOWS** the key from the spread. `{ ...scope.enrollmentWhere, course: scope.courseWhere }` silently drops the bundle's predicate — object-literal key precedence, no type error, no lint. That shadowing is the trap to remember.
- `courseWhere` stays archive-neutral: its callers are top-level Course reads the extension already filters.

`getStatusTrackerSummaryForOrg` (`src/lib/reminders/status-tracker.ts`) had no archive predicate at all and is the most visible symptom — an overdue row naming a course the Courses page says does not exist, which no manager action can clear. It does not use `DashboardScope`, so it states `course: { archivedAt: null }` on both of its reads.

Guard: parity Tier 1 now asserts `where.course` matches `{ archivedAt: null }` on EVERY captured enrollment predicate, which catches both a dropped bundle predicate and a shadowing call site. Behavioural coverage lives in `course.archive-visibility.test.ts`, whose harness was extended with an in-memory enrollment table joined to the course table on `courseId`.

`listOfferedVideoCourses` (`offering.ts`), which the sweep found filtering `status: 'published'` with no archive predicate and zero callers, has since been deleted.

**The extension cannot reach nested `include`/`select`** — mutating those changes the output type, which Prisma forbids. Every traversal into Course/Document from another model is to-one (`Enrollment.course`, `Certificate.course`, `CourseAssignment.course`, `CourseVersion.documentVersion.document`) where Prisma has no `where` anyway, and leaving archived rows visible there is the desired behaviour. The only to-many ones (`OrganizationUser.createdCourses` / `.documents`) are in the `/system` ops panel, which should see everything.

**Do NOT add `archivedAt: null` inside `orgCourseWhere` / `authoredCourseWhere`** (`src/lib/course/org-scope.ts`) — the auditor export builds its queries from `orgCourseWhere` and needs archived rows; baking it in defeats the escape hatch at the one call site that matters most.

**The maintainer's rule for deciding a new site:** an auditor (or an operator) must never see one number on screen and a different one in the record they download. Where a surface and its export disagree, the export wins and the surface moves to `rawPrisma` — but only the archivable model's own read, never the permission gates or facility narrowing around it.

Related: [[gotcha_prisma_extension_breaks_transactionclient_type]], [[courses-and-documents-are-global]], [[gotcha_document_identity_is_org_wide]].

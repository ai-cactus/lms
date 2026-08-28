---
name: courses-video-reading-consolidation-tests
description: Test patterns for the video/reading consolidation PR (branch feature/courses-video-reading-consolidation) — merge/de-dupe, catalog auth guards, billing gate, isGlobalCatalog row-action lockdown
metadata:
  type: project
---

Branch `feature/courses-video-reading-consolidation` removed the "My Courses /
Available Video Courses" outer tabs from `/dashboard/courses`; the page now
merges `getCourses()` (own+adopted) with the new
`listGlobalVideoCatalogCourses()` (org-scoped tallies joined onto a cached,
tenant-independent global catalog) directly in the Server Component, not
inside `getCourses` itself — deliberate, because `getCourses` also feeds
`AssignCoursesModal` and `assignCourseToUsers` rejects any course whose
`creator.organizationId` differs from the caller's org.

**Deleting a describe block silently drops coverage of a surviving caller.**
Removing `listAvailableVideoCourses`'s test block deleted the only assertions
on `getGlobalVideoCatalog`'s query shape (`type:'video', isGlobal:true,
status:'published'`, `orderBy:{createdAt:'asc'}`, no `organizationId`) even
though `listGlobalVideoCatalogCourses` still calls it. Restored directly in
`src/app/actions/offering.test.ts` (extended the existing hoisted-mock
scaffolding rather than a new file) — added `prisma.enrollment.groupBy` mock,
8 new tests covering query shape, Unauthorized/No organization/Forbidden
guards, the empty-catalog short-circuit (skips the enrollment query
entirely), and that enrollment tallies are scoped to `organizationUser: {
organizationId }` — a cross-tenant count here would leak into a number every
org's page can see.

**Row-action lockdown for platform-catalog rows.** `CoursesListClient`'s
`buildRowActions()` returns `[]` unconditionally for any course with
`isGlobalCatalog: true`, regardless of the viewer's own permission grants —
even an owner who gets the full action set on their own courses sees nothing
on a catalog row. Worth its own explicit test (`CoursesListClient.test.tsx`)
since the existing per-role gating tests never varied `isGlobalCatalog`.

**Landing-tab persistence gotcha.** `activeTab` is a lazy `useState`
initializer (`courses.length > 0 && courses.every(c => c.type !== 'video') ?
'slides' : 'video'`) — computed ONCE on mount, never recomputed when the
`courses` prop changes later (e.g. after `revalidatePath`). Tested via RTL
`rerender()`: switch tab, then rerender with a courses array that would have
computed a *different* default tab on fresh mount, and assert the user's
manually-selected tab survives.

**Prisma-failure-must-be-logged pattern.** The page's `.catch()` on the
catalog lookup degrades to `[]` but must call `logger.error(...)`, not
swallow silently — this needs `vi.mock('@/lib/logger', ...)` added to
`page.test.tsx` (it wasn't mocked before) and an explicit
`expect(mockLoggerError).toHaveBeenCalledWith(expect.objectContaining({ err,
organizationId }))` assertion; asserting only that the page still renders
would have missed a real silent-swallow regression.

**Input role gotcha (recurring).** The shared `Input` component defaults to
`type="text"`, so its accessible role is `textbox`, not `searchbox`, even
with a search icon and "Search courses..." placeholder — `getByRole('textbox',
{ name: 'Search courses' })`, not `getByRole('searchbox', ...)`.

**PR #523 org-manager visibility regression guard already existed and needed
no changes**: `src/app/actions/get-courses.test.ts` (`describe('getCourses —
org-manager visibility (#15)')`) already pins `creator: { organizationId }`
for owner/admin/hr/clinical_director/supervisor and the non-widened
finance/worker paths. Confirmed still green as part of the baseline run — no
new test needed, just verified.

**E2E reasoning (not run this session — sandbox lacks `@next/swc` bindings /
font egress):** the 7 click paths in `tests/e2e/reminders.spec.ts` and
`tests/e2e/course.spec.ts:25` that `goto('/dashboard/courses')` then
immediately click the seeded course (type `'text'`, no tab click first) are
safe under the restored reading-only-fallback landing logic **only if** that
org's course set is text-only at the time — true for the shared seed
(`prisma/seed.ts:471`, one text course, `admin@test.com`'s org).
`course.spec.ts:272-332`'s exact `Video 1`/`Reading Course 1` count
assertions looked "sensitized to any published global video course in the DB"
per the task brief, but tracing `seedCourseTabsFixture()` shows it creates a
**fresh org with no `subscriptions` row at all** — `hasActiveBilling(null)` is
`false`, so `listGlobalVideoCatalogCourses()` is never called for that org
and the catalog can't leak into those counts regardless of what other
published global video courses exist in the e2e DB. Verified no
default/trigger auto-inserts a subscription row (checked
`prisma/organization.prisma`'s `Subscription` model and the fixture's raw
SQL). Worth re-verifying if `seedCourseTabsFixture()` or billing defaults
change.

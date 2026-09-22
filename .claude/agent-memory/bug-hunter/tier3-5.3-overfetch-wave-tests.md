---
name: tier3-5.3-overfetch-wave-tests
description: Test updates + behavior-preservation verification for the Tier 3 §5.3 low-risk over-fetch wave (getCourseById/getCourses select narrowing, getStaffDetails, getAvailableUsers, video-catalog unstable_cache) on feat/more-performance
metadata:
  type: project
---

Verified 2026-08-05 on branch `feat/more-performance` (commits d192961..e46ac44, 5 commits). All behavior-preserving Prisma query-shape changes (include→select, groupBy aggregation, unstable_cache on the video catalog) confirmed faithful by tracing every consumer component field-by-field, not just by making tests green.

**Why:** code-ninja flagged 3 files as mock/assertion gaps, but a 4th (`video-course.test.ts`, 13 tests) was ALSO broken by the same wave (missing `revalidateTag` mock) and wasn't in the handoff list — a `npx vitest run` full-suite pass is required before declaring a wave's tests fixed; don't trust a partial file list from the handoff.

**How to apply:**
- Fixed 4 files: `offering.test.ts` (added `unstable_cache` passthrough mock + `orgCourseOffering.findMany` mock, rewrote `listAvailableVideoCourses` describe block for the cached-catalog/per-org-join split), `get-courses.test.ts` (added `enrollment.groupBy` mock, fixtures moved to `_count.lessons` shape), `course.session-org-scoping.test.ts` (added `enrollment.groupBy` mock; `include.enrollments.where` → `select.enrollments.where`, org-scoping VALUE unchanged), `video-course.test.ts` (added `revalidateTag` mock + assertions on all 3 catalog-mutating call sites).
- **Real regression check performed, none found.** Traced every narrowed select against its actual consumers: `TrainingDetails.tsx` + `CoursePreview.tsx` (courseDetailSelect — full field audit, all present), `getStaffDetails` consumer (staff.ts itself — confirmed the dropped `quizAttempts: {take:1}` was genuinely dead code, never read), `getAvailableUsers` return mapping (enrollment.ts itself). `getCourses` groupBy counts reproduce the exact old per-row math including the own-courses-unscoped vs adopted-courses-org-scoped asymmetry (confirmed present in both old and new code — not a regression).
- **(Historical, 2026-08-05) `getCourseById` used to return the full roster to an enrolled worker.** It is FIXED: the action now filters `enrollments` to the caller's own row for non-privileged sessions, and scopes the roster to the caller's organisation (`67a282b8`).
- Catalog cache: `revalidateTag('video-catalog', 'max')` (2-arg form, required by Next 16) is wired into all 3 catalog-mutating call sites in `video-course.ts` (create/update/status-change) and none are missing; `verifyGlobalVideoMedia` correctly has no invalidation since it only flips `mediaStatus`, not a catalog-visible field.

---
name: gotcha-assignment-action-authorization-split
description: RESOLVED 2026-08-31 — enrollUsers now authorizes courses by ORG ownership like assignCourseToUsers. History of the split, and the mock shape every enrollUsers test now needs.
metadata:
  type: project
---

`enrollUsers` (src/app/actions/enrollment.ts) and `assignCourseToUsers`
(src/app/actions/course.ts) used to disagree on course authorization, and
picking the wrong one silently broke assignment with a misleading
"Course not found".

- `enrollUsers` authorized on **creator identity**: `createdByOrgUserId === session.user.organizationUserId`, plus global-catalog/offering escapes. A course created by a COLLEAGUE in the same org failed it. Confirmed live 2026-08-14: every course in a seeded org's catalog was same-org, non-global, created by another member, so this path rejected all of them.
- `assignCourseToUsers` authorized on **org ownership** (the COU-004 ruling).

**Closed on branch `bugfix/assign-course-emails` (commit c03466de):** `enrollUsers`
gained an `isSameOrgCourse` branch, so both actions now accept any course the
caller's own organization owns. Not a privilege widening — every role holding
`enrollment.create` also holds `assignment.create`, so the same caller could
already assign the same course through the other action.

**How to apply now:**

- Either action is safe to build a new assign entry point on; choose by SHAPE, not authorization. `enrollUsers` adds invite-parking for non-members, the seat gate, and the batched-notice `deferWorkerNotification` option; `assignCourseToUsers` is the one-course/many-emails path and never invites.
- `enrollUsers` selects `creator: { organizationId }`. **Any prisma mock returning a course from `course.findUnique` must include that relation** or the action throws `Cannot read properties of undefined`. A fixture meant to exercise only the global-catalog/offering branch needs a creator org that is NOT the caller's (`'org-platform'`), or it passes for the wrong reason.
- **Still open:** `assignCourseToRoleTargets` (enrollment.ts, ~line 670) carries the same creator-identity gate and was deliberately left alone — role-target assignment of a colleague's non-global course still fails. Fix it the same way if it surfaces.

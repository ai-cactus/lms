---
name: gotcha-assignment-action-authorization-split
description: Two course-assignment actions disagree on course authorization — enrollUsers gates on creator identity, assignCourseToUsers on org ownership (COU-004). Pick the right one when building any new assign entry point.
metadata:
  type: project
---

`enrollUsers` (src/app/actions/enrollment.ts) and `assignCourseToUsers`
(src/app/actions/course.ts) do NOT authorize courses the same way, and picking
the wrong one silently breaks assignment with a misleading "Course not found".

- `enrollUsers` authorizes on **creator identity**: `createdByOrgUserId === session.user.organizationUserId`, plus global-catalog/offering escapes. A course created by a COLLEAGUE in the same org fails it.
- `assignCourseToUsers` authorizes on **org ownership**: `course.creator.organizationId === session.user.organizationId`. This is the COU-004 ruling — an org's admins/HR must be able to assign any course their organization owns. It has no global-catalog branch.

**Why:** COU-004 fixed the courses-list assign modal by routing it through
`assignCourseToUsers`; `enrollUsers` was never updated, so the older creator-only
rule still lives there. Confirmed live on 2026-08-14: every course in a seeded
org's catalog was same-org, non-global, created by another member — so the
`enrollUsers` path rejected all of them while `assignCourseToUsers` accepted all
of them. Prebuilt/global courses are FORKED into the org on adoption
(`addPrebuiltCourseToOrg` → `forkCourse`), so in practice an org's catalog is
org-owned and the org-ownership rule is the one that matches reality.

**How to apply:** When building or reviewing any new assignment entry point,
delegate to `assignCourseToUsers`, not `enrollUsers`, unless you specifically
need `enrollUsers`' extras (invite-parking for non-members, seat gate,
per-enrollment worker notification, INITIAL_LAUNCH reminder row). Those extras
are the tradeoff you accept for correct org-level authorization. If you ever get
"Course not found" from an assign flow, check this divergence first rather than
the course data.

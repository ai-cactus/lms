---
name: course-publish-has-three-paths
description: Three distinct code paths flip a Course to published; the reviewer (approvedBy/approvedAt) is only recorded on two of them
metadata:
  type: project
---

A `Course` reaches `status: 'published'` from three places, not one:

1. `createFullCourse` (`src/app/actions/course.ts`) — the wizard's direct publish,
   when the F-051 quality gate does NOT hold the course back.
2. `publishCourse` — the deferred replay, after the admin acknowledges warnings.
3. `publishCourseOnAssignment` (`src/lib/course/publish-on-assign.ts`) — a *silent*
   promotion: assigning a plain draft to staff publishes it as a side effect.

**Why:** PR-1 of the 2026-09 course-creation redesign (decision D8) records the
publish reviewer on `Course.approvedByOrgUserId` / `approvedAt`. Paths 1 and 2 now
write it. Path 3 deliberately does not — it only receives a `actorUserId` (a `User`
id, not an `OrganizationUser` id), and nobody reviewed anything in that flow.

**How to apply:** Anything rendering "Approved by …" must tolerate a published
course with a null `approvedBy` — path 3 and every pre-D8 course produce exactly
that. And any future change to publish semantics has to be applied to all three
sites; grepping for `status: 'published'` finds them, grepping `publishCourse` does
not. Related: [[project_wizard-step7-review-honest-gaps]].

Also worth knowing: the design doc asked for NEW `reviewedBy`/`reviewedAt` columns,
but `approvedByOrgUserId` / `approvedAt` / the `CourseApprover` relation had been
sitting dormant in `prisma/course.prisma` with zero readers since before the spec —
so D8 shipped with no migration at all.

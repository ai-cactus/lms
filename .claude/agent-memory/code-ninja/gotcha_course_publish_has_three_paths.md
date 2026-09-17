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
3. `publishCourseOnAssignment` (`src/lib/course/publish-on-assign.ts`) — assigning
   a plain draft to staff publishes it as a side effect. It is no longer silent:
   D9 gave it the `approvedByOrgUserId` it lacked, and since the no-draft-enrolments
   ruling it RETURNS a boolean and every assign path refuses when it is `false`.

**Why:** PR-1 of the 2026-09 course-creation redesign (decision D8) records the
publish reviewer on `Course.approvedByOrgUserId` / `approvedAt`. Paths 1 and 2 write
it; D9 then added it to path 3 as well (the person who assigns a draft is taking
responsibility for it going live), so it takes BOTH an `actorUserId` (a `User` id,
for logging) and an `approvedByOrgUserId` (the membership FK).

⛔ Path 3's ORDER is load-bearing and easy to destroy: it runs before the first
enrollment write, which is the only reason "no learner is ever enrolled in a draft"
holds. A literal `status !== 'published'` gate on the assign actions does NOT work —
Assign & Publish (`AssignPublishClient.tsx`) submits an unheld draft on purpose, and
`publishCourse` cannot be called first because it requires authorship, which a
supervisor assigning a colleague's course does not have.

**How to apply:** Anything rendering "Approved by …" must tolerate a published
course with a null `approvedBy` — every pre-D8/D9 course produces exactly that. And any future change to publish semantics has to be applied to all three
sites; grepping for `status: 'published'` finds them, grepping `publishCourse` does
not. Related: [[project_wizard-step7-review-honest-gaps]].

Also worth knowing: the design doc asked for NEW `reviewedBy`/`reviewedAt` columns,
but `approvedByOrgUserId` / `approvedAt` / the `CourseApprover` relation had been
sitting dormant in `prisma/course.prisma` with zero readers since before the spec —
so D8 shipped with no migration at all.

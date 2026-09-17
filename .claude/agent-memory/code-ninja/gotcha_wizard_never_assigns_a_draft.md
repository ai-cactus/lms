---
name: wizard-never-assigns-a-draft
description: Step 7 publishes-then-assigns or parks the intent — it never calls an assign action on a draft, so a status gate there is safe; the flow that DOES submit a draft is the separate /assign page
metadata:
  type: project
---

The course wizard's Step 7 ("Assign & Publish") never hands a draft to an assign
action. `createFullCourse` (`src/app/actions/course.ts`) branches on the F-051
quality verdict:

- **not held** → the course is created `status: 'published'` up front, and only
  then does it call `enrollUsers` (email mode) / does `CourseWizard.tsx` call
  `assignCourseToRoles` (role mode, guarded by `if (!result.reviewRequired …)`).
- **held** → created as a draft with the intent parked on
  `Course.pendingAssignment` (`buildPendingAssignment`), assigning nobody.
  `publishCourse` clears the hold and replays it.

**Why:** this is the answer to "will a status gate on the assign actions break the
wizard?" — no. The flow the old `enrollment.ts` comment meant by "the Assign &
Publish flow relies on it" is a *different* surface: the standalone page at
`/dashboard/(wizard)/training/courses/[id]/assign`
(`AssignPublishClient.tsx`), reached from the courses list. That one submits an
unheld draft on purpose and assigns FIRST, publishing after. Its page-level course
lookup has no status filter, deliberately.

**How to apply:** Before touching any draft/assign rule, separate these two
surfaces — they are both called "Assign & Publish" and only one of them assigns a
draft. The deferral (`pendingAssignment` + replay) covers the wizard only; extending
it to the `/assign` page would be strictly worse, since that page publishes in the
same submit anyway. Related: [[course-publish-has-three-paths]],
[[project_course-wizard-9-step]].

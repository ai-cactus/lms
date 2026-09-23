---
name: gotcha-enrolluser-deadline-scope-defaults-org-wide
description: enrollUsers' dueAt lands on the ORG-WIDE CourseAssignment unless the caller opts into deadlineScope 'enrollment'; the past-deadline guard means something different in each scope
metadata:
  type: project
---

`enrollUsers(courseId, entries, assignmentSettings, options)` writes `assignmentSettings.dueAt`
to the organisation-wide `CourseAssignment` row by default. Every other settings field honours
the tri-state "omit = no opinion" contract, so `dueAt` reads as if it did too — it does not.
A surface whose deadline control is **per-person** must pass
`options.deadlineScope: 'enrollment'`, which omits `dueAt` from the shared row and routes the
date into each new enrollee's own `Enrollment.dueAt` instead.

**Why:** BUG-20 (2026-09-23). The staff-profile assign modal picked "1 year" for one worker and
moved the deadline — and the reminder ladder anchored on it — for every other enrollee in the
org. The shared-row doc on `UpsertCourseAssignmentParams` already stated the intended contract;
only `enrollUsers` broke it.

**How to apply:**
- Default `'assignment'` is correct for the assign page, the wizard, role targeting and the
  parked-intent replay in `publishCourse` — their deadline control speaks for the whole course.
- `'enrollment'` is used by both staff-profile paths in `src/app/actions/staff.ts`
  (`assignCoursesToStaffMember` and its deprecated single-course revert path). If a third
  per-person deadline surface appears, it needs the flag too — nothing enforces it.
- The past-deadline guard is **not** the same rule in both scopes. In `'assignment'` scope a
  past date is refused only when it differs from the stored one (the late-joiner exemption). In
  `'enrollment'` scope the stored row is never consulted: every enrollee is new, so any past
  date is refused.
- The window (`dueWindowDays`) always comes from the shared row in both scopes — a per-person
  deadline must not cost the enrollee the org-wide window it falls back to.
- Acceptance coverage: `tests/e2e/staff-assign-multiple-courses.spec.ts` scenario 4 (seeds a
  `2099-01-01` sentinel on the shared row) and `src/app/actions/enrollment.deadline-scope.test.ts`.

Related: [[gotcha_assignment_row_has_no_role_target_scope]],
[[gotcha_role_assign_count_vs_reach]].

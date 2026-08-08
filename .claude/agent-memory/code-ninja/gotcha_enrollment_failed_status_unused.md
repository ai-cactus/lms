---
name: gotcha-enrollment-failed-status-unused
description: EnrollmentStatus.failed is never written by the quiz path — pass/fail must be derived from score vs. Quiz.passingScore, not from status
metadata:
  type: project
---

`EnrollmentStatus.failed` exists in the schema but no runtime path writes it: `submitQuizAttempt`
(`src/app/actions/enrollment.ts`) sets `status: 'in_progress'` + `score` whether or not the learner
passed. Attestation (`attestCourse` in `src/app/actions/course.ts`) sets `attested` without checking
the score either.

**Why:** any pass-rate / pass-fail metric written as `status IN ('completed','attested')` vs
`'failed'` silently reports a 100% pass rate. The only truthful signal is
`Enrollment.score >= Quiz.passingScore` (default 70 when the quiz has none) — which is what
`getDashboardData` and `getGlobalDashboardData` both do.

**How to apply:** when adding any pass/fail, first-time-pass or grade metric, group by
`['courseId', 'score']` and join the per-course passing bar in memory (a quiz attaches via either
`Quiz.courseId` or `Quiz.lesson.courseId` — resolve both). Never branch on the `failed` status.
Related: [[rbac_role_model]].

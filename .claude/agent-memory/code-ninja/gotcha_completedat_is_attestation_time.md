---
name: gotcha-completedat-is-attestation-time
description: Enrollment.completedAt means ATTESTATION time, not quiz-pass time — attestCourse is the only writer, and backfilling it can trigger a renewal-enrollment wave
metadata:
  type: project
---

`Enrollment.completedAt` = **the instant the learner signed the attestation**,
not the instant they passed the quiz. BUG-08 (fixed on
`fix/enrollment-completed-at`) was that nothing wrote it at all.

**Why that semantics and not quiz-pass:** passing the quiz leaves the enrollment
`in_progress` — `/api/quiz/[id]/submit` writes `in_progress | locked` and says so
in a comment ("Passing the quiz does NOT complete the course"). Every reader that
reports completion filters `status IN ('completed','attested')`, so a date
stamped at quiz-pass would sit on rows those same readers print as unfinished.
The quiz-pass moment is not lost: it is the passing `QuizAttempt.completedAt`.

**The completion surface is smaller than it looks.** Despite the enum,
`EnrollmentStatus.completed` is **never written by any code in `src/`** (only by
`prisma/seed.ts`, `scripts/seed-*.ts`, and rows predating attestation) — see
`LearnClient.tsx`'s comment. `attested` is the one terminal status the product
produces, and `attestCourse` (`src/app/actions/course.ts`) is its only writer, so
"every path that completes an enrollment" is exactly one path. It now stamps
`completedAt` and `attestedAt` from ONE `Date`; `retakeQuiz` clears both. Sibling
`failed` is likewise dead — see [[gotcha_enrollment_failed_status_unused]].

**⚠️ Backfilling `completedAt` arms the renewal sweep.**
`runRenewalRetriggerPrePass` in `src/lib/reminders/sweep.ts` selects terminal
enrollments with `completedAt: { not: null }` on a recurring `CourseAssignment`
and, once `completedAt + cycleLengthDays − RENEWAL_LEAD_DAYS` is past, **creates a
new enrollment and emails a course-launch notice**. Every row the backfill fills
becomes eligible at once, so a deploy can fire a burst of real learner emails.
Size it before deploying:

```sql
SELECT count(*) FROM enrollments e
JOIN course_assignments ca ON ca.id = e.assignment_id
WHERE ca.renewal_cycle <> 'none' AND e.status IN ('completed','attested');
```

**How to apply:** treat `completedAt` and `attestedAt` as one fact with two
columns — never write one without the other, and never derive "passed the quiz"
from `completedAt` (use `score >= Quiz.passingScore`). Related:
[[gotcha_no_time_on_task_data]] — `completedAt − startedAt` is calendar days from
ASSIGNMENT, never study time.

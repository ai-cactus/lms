---
name: gotcha-no-time-on-task-data
description: Nothing in the schema records how long a learner actually spent — Course.duration is an AI estimate and Enrollment.startedAt is the ASSIGNMENT date, so no "average time" metric is computable
metadata:
  type: project
---

There is **no time-on-task data anywhere in this schema**. Any request for an
"average duration", "time spent", or "how long learners actually took" metric
cannot be satisfied from the database, and the two fields that look like they
could are both traps.

**`Course.duration` (Int?, minutes) is a per-course ESTIMATE, never a
measurement.** It comes from the document-analysis prompt in
`src/app/actions/course-ai.ts` ("Estimated time in minutes to read/complete this
content"), is written once at creation, and is the PARENT of `Lesson.duration`,
not a sum of it — `GenerationController` divides the course estimate across
sections. `src/types/course.ts` says so itself in the `completionDeadlineDays`
doc comment. Video courses default it to `round(courseVideoSeconds / 60)`. The
transcode worker never overwrites it.

**`Enrollment.startedAt` is the ASSIGNMENT date, not a learning-session start.**
It is `@default(now())` and `src/lib/enrollment/create.ts` sets it at enrolment
time. The rest of the repo reads it that way: `src/lib/pdf-reports.ts` maps it to
`dateAssigned`, `src/app/actions/staff.ts` to `enrolledAt`, and
`src/lib/audit-reports/date-range.ts` treats it as the audit date. So
`completedAt - startedAt` is **calendar days from assignment to completion**, not
minutes of study.

There is already one place that gets this wrong: the `course_completed` PostHog
capture in `src/app/actions/enrollment.ts` sends
`total_minutes: (Date.now() - startedAt) / 60_000`, which is elapsed calendar
time. Analytics only — do not copy the pattern into UI.

**Why:** the 2026-09-17 course-detail redesign shipped a stat card the Figma
frame labels "Average Duration". The maintainer ruled the label stands but the
value must not be faked as measured, so the card renders `course.duration` (the
estimate) and the component carries a comment saying exactly that.

**How to apply:** if asked for an average/actual duration, say up front that the
data does not exist rather than deriving one from `startedAt` or dressing up the
estimate. Adding it would need a new per-learner time-accumulation column and a
writer in the learn player — `videoPositionSeconds` is a resume marker, not
accumulated watch time. See [[dashboard-metrics-glossary]].

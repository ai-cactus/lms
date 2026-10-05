---
name: project-deadline-zone-semantics
description: BUG-12.3/Q-32 (2026-09-29) — assignment dueAt is a wall clock, enrollment dueAt a learner-zone instant; 'already past' is judged per learner (skip vs window)
metadata:
  type: project
---

Ruled 2026-09-29 (BUG-12.3): a picked deadline ("due 30 Sept") ends at 23:59
on that date in the **learner's facility zone** — oldest active roster
facility's `timezone` (`resolveMemberFacility`), fallback `DEFAULT_TZ`
(America/New_York). Stored data was NOT migrated.

Two different things share the name `dueAt`:

- `CourseAssignment.dueAt` (and what every assign surface submits via
  `combineDateAndTime`) = the picked date+time held in **UTC fields**, one value
  for the whole org. Not an instant. `formatTimeOfDay`/`toDateInput` read it in
  UTC so it round-trips.
- `Enrollment.dueAt` = a real instant, resolved per learner by
  `computeDueAt({..., timeZone})` → `zonedWallClockToInstant`, inside the single
  funnel `createEnrollmentForUser` (covers enrollUsers, role targets + sweep,
  invite accept, wizard, staff modal). Retake: `retakeDueAtIfNotPast`.
  Window/renewal deadlines are durations from an instant — no zone.

**Why:** a US-zone 23:59 is already the next day in UTC, so any renderer that
formats `Enrollment.dueAt` without the learner's zone prints the day AFTER the
one picked.

**How to apply:** any new surface that shows an enrollment deadline must carry
the learner's zone next to it and use `formatDateInTz` (`src/lib/reminders/time.ts`,
client-safe). Emails take a required `timeZone` arg; `LearnerCourseRow` has
`deadlineTimeZone`; Status Tracker rows carry `timeZone`; the retake dialog takes
`learnerTimeZone` (roster select / `getStaffDetails`) and pre-fills
`defaultRetakeDueDate(now, tz)`, the same date the server defaults to. Q-32 (ruled 2026-09-29): "already past" is judged per learner inside
`createEnrollmentForUser` via `ctx.onPassedDeadline` (required): `'skip'` for
admin-initiated assigns (outcome `deadlinePassed`, surfaced with
`describeDeadlinePassed`), `'useWindow'` for the automatic paths (role-join hook,
sweep backstop, invite accept) so a new hire is never left untrained.
`isPastDeadlineChange` now only refuses a date past even in UTC−12; pickers use
`earliestPickableDueDate`. Tests with fixed 2026 deadlines must pin the clock.

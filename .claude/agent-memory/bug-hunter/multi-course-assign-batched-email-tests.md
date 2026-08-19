---
name: multi-course-assign-batched-email-tests
description: Test patterns and environment gotchas from testing the multi-course staff-assign-batched-email feature (production-line branch, no multi-facility)
metadata:
  type: project
---

Feature: assigning N courses to one staff member from their profile now produces N
enrollments but exactly ONE email + ONE in-app notification (`src/lib/enrollment/notify.ts`,
`CreateEnrollmentContext.deferWorkerNotification`, `assignCoursesToStaffMember` in
`src/app/actions/staff.ts`, new `AssignCoursesModal.tsx`). Branch cut from `origin/main`
(production line, no multi-facility) — `Enrollment` keys on `userId`.

New/updated test files: `src/lib/enrollment/create.test.ts` (deferral tests added),
`src/lib/enrollment/notify.test.ts` (new), `src/lib/email.test.ts` (sendCoursesAssignedEmail
tests added), `src/app/actions/staff.assign-courses.test.ts` (new),
`src/app/actions/enrollment.assignment.test.ts` (preserve-mode tests added),
`src/app/actions/enrollment.batch-equivalence.test.ts` (deferWorkerNotification equivalence
added), `src/lib/enrollment/invite-courses.test.ts` (batched-notice tests added),
`src/components/dashboard/staff/AssignCoursesModal.test.tsx` (new RTL),
`tests/e2e/staff-assign-multiple-courses.spec.ts` (new), `tests/e2e/rbac-staff-view-only.spec.ts`
(Clinical Director split from Finance — CD now sees Assign Course via `assignment.create`).

**Local `lms_e2e` Postgres had drifted onto the DEV-LINE (multi-facility/OrganizationUser)
schema** — `users` table had no `organization_id`/`role`/`facility_id` columns at all, only
`organization_users` + `last_active_organization_id`. This branch's `prisma migrate deploy`
only applies the 2 newest pending migrations on top of whatever `_prisma_migrations` history
is already recorded, so it silently produced an incompatible half-migrated DB rather than
erroring. Fix: `DROP DATABASE lms_e2e; CREATE DATABASE lms_e2e OWNER postgres;` then
`prisma migrate deploy` fresh (42 migrations, all from this branch's own line) — that builds
the correct production schema. Always check `\d users` for `organization_id` before trusting
`migrate deploy`'s "already applied" summary on a long-lived local e2e DB, especially when
switching between the `dev` and a production-cut feature branch.

**Next.js Server Actions auto-revalidate the invoking page's Server Components live** —
calling `assignCoursesToStaffMember` (a `'use server'` action) with `revalidatePath(...)`
inside it causes the CURRENT tab's Server Component props (e.g. `enrolledCourseIds` passed
into `AssignCoursesModal`) to refresh automatically after the action resolves, with no
`router.refresh()` needed and no full page reload. This defeated an initial test design that
assumed closing/reopening the modal without a `page.reload()` would leave `enrolledCourseIds`
stale. It does NOT, for the SAME tab/session that invoked the action. A genuinely stale prop
requires a SEPARATE tab (`page.context().newPage()`, same session/cookies, opened and loaded
BEFORE the action runs) — this also more realistically models two admins racing on the same
staff profile. Already-enrolled courses render with a disabled checkbox by design
(`AssignCoursesModal`'s own docstring), so a truly-already-enrolled course can never be
selected via a normal `.click()` once its tab's props are current — the disabled state IS the
product's defense, and any e2e test hitting the server's "zero newly assigned" branch through
a real browser must exploit genuine prop staleness (a second tab), not assume it persists
across a same-tab modal close/reopen.

**Timezone bug when binding a JS `Date` against a `timestamp without time zone` Postgres
column via `pg`**: this repo's `created_at` columns are all `timestamp without time zone`,
populated from the DB server's own (UTC) clock. Binding a raw JS `Date` object as a query
parameter serializes it using the Node PROCESS's LOCAL wall-clock components (here,
WSL2 host timezone `Africa/Lagos`, UTC+1) rather than UTC — causing `created_at >= $since`
comparisons to skew by the host's UTC offset and silently return 0 rows that actually exist.
Symptom looked exactly like "the feature doesn't write the row" (confirmed real rows existed
via a direct `psql` query after temporarily disabling test cleanup) when it was purely a
test-side parameter-serialization bug. Fix: always pass `since.toISOString()` (a string) as
the bound parameter for any `>= /<= a timestamp-without-tz column` comparison in a `pg`-based
e2e spec, never a raw `Date` object. Worth checking any OTHER e2e spec in this repo that binds
a `Date` directly against `created_at`/`sent_at`/etc. for the same latent bug on a non-UTC
host.

See also [[e2e-local-auth-url-env-trap]], [[full-e2e-suite-serial-flakiness]].

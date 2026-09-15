---
name: gotcha-course-roster-spans-tenants
description: A video course's enrollments legitimately span every tenant, so the course-detail roster needs a query-level org filter — but the access gate reads that same roster, so the caller's own row must be exempt from it
metadata:
  type: project
---

`getCourseById` / `getCourseForOrgView` return `courseDetailSelect.enrollments`, which carries
staff PII (email, full name, role, score). **A video course is one row shared by every
organisation** (Theraptly publishes it, `isGlobal: true`, creator = the `system` user), so its
enrollment set is cross-tenant by construction. A reading course is org-generated and
single-tenant. That asymmetry is the whole reason the roster needs an org predicate at all.

**Why:** fixed 2026-09-14 — `getCourseById` had no org predicate, so on an adopted video course
any manager holding `user.read` who was enrolled received every other tenant's enrollees' PII.
`narrowRosterToFacilityScope` does NOT cover this: it early-returns unchanged for every org-wide
role.

**How to apply:**

- Two filters, both required: the **query** does the cross-tenant half (a row never fetched
  cannot leak), `narrowRosterToFacilityScope` does the within-tenant facility half afterwards.
  Never treat one as a replacement for the other.
- **The access gate reads the roster it is about to filter** — `isEnrolled` comes from
  `course.enrollments.some(...userId === session.user.id)`. So the query predicate is
  `organizationUser: { OR: [{ organizationId }, { userId: caller }] }`, not a bare
  `organizationId`: the own-row clause is what keeps the access decision bit-for-bit identical
  (it also covers a user whose enrollment sits under a different membership than their active
  one). Anything that moves this filter must re-check that.
- No `organizationId` on the session ⇒ roster collapses to the caller's own rows. Never pass
  `organizationId: undefined` into a Prisma predicate — the clause is dropped and the filter
  silently becomes "no filter" (the same trap `staff-where.ts` is named after).
- **There is deliberately no creator exemption** (removed in the same fix, user-approved). For a
  video course the "creator" is the system user, not a customer; for a reading course the roster
  is single-tenant anyway. Theraptly's cross-org view belongs in `/system`. Restoring
  `isCreator ? course : narrow(...)` re-opens the leak. See
  [[gotcha_document_identity_is_org_wide]], [[project_courses_video_reading_consolidation]].
- `TrainingDetails` derives total learners / completion / average score / certificates from this
  roster, so on an adopted video course those figures are now org+facility scoped rather than
  cross-tenant inflated. That is the correct reading, not a regression.

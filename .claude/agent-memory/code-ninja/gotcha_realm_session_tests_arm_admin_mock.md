---
name: gotcha-realm-session-tests-arm-admin-mock
description: After BUG-47 admin-only actions read only the admin instance; worker-role gate tests must arm the role on the ADMIN auth mock or they test nothing
metadata:
  type: project
---

Since BUG-47 (2026-09-29, branch `bugfix/realm-session-helpers`) no action prefers the admin
session over the worker one. Admin-only actions call `getRealmSession('admin')`; actions both
portals call take a `realm` argument from the caller; `issueCertificate` picks the session that
OWNS the enrolment (same shape as `/api/certificates/[id]`).

**Why:** a browser can hold both portals for two different accounts, and the old
`admin ?? worker` helper ran worker-portal actions as the admin (the BUG-05 class).

**How to apply:**
- A unit test that proves "a worker role is refused by the `isAdminRole` half" on an admin-only
  action must arm that role on the `@/auth` (admin) mock. Armed on `@/auth.worker` it now just
  hits "Unauthorized" and the gate is never exercised — pair it with a separate
  "worker portal is never read" test.
- New dual-portal actions: add `realm: PortalRealm` as the FIRST parameter (matches user.ts),
  thread it from the page/component, never re-introduce a fallback.
- The inline dual-session learner actions (`attestCourse`, `startCourse`, `retakeQuiz`) match by
  ownership, not preference, and were deliberately left alone. `requestCourseRetry` (Q-35
  rewrite) is `getRealmSession('worker')` ONLY — a manager learner reaches it via learn mode,
  which mints a worker cookie.

Related: [[auth-instance-vs-role]], [[gotcha-admin-auth-instance-is-the-tier-check]].

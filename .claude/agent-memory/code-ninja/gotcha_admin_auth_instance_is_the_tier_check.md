---
name: gotcha-admin-auth-instance-is-the-tier-check
description: Which auth instance an action resolves decides whether a bare `can(worker-held-verb)` gate is actually exploitable — `auth()` from '@/auth' is itself a tier check, `resolveSession()`/`getPortalSessions()` are not
metadata:
  type: project
---

When sweeping for the `can(roleKey, V)`-with-no-`isAdminRole` bug (V being one of
the 11 verbs in `workerPermissions`), triage on the **session source** before
anything else, or you will file a pile of false positives.

`src/auth.ts` builds the admin instance with `allowedRoles: ADMIN_ROLES`, and
`create-auth-instance.ts` invalidates any session whose role is not in
`sessionAllowedRoles` on **every** decode. So a worker role can never hold a
valid `'@/auth'` session:

- `auth()` from `'@/auth'`, and everything downstream of it (`evaluatePermission`
  → `authorize()`, `requirePermission*`, `checkPermission`, every `/dashboard`
  page), carries an implicit admin-tier fence. A bare worker-held verb there is
  ugly but not reachable by a worker.
- `resolveSession()` (the local admin-then-worker helper in course.ts,
  offering.ts, enrollment.ts, certificate.ts, user.ts) and `getPortalSessions()`
  have **no** tier fence. These are the only genuinely exposed surfaces.
- `src/auth.worker.ts` sets `sessionAllowedRoles: ALL_ROLES`, so a manager
  bridged into Learn mode carries an admin role on the worker cookie — the
  worker instance is not a worker-tier fence either.

**Why:** a sweep on 2026-09-16 enumerated all ~100 registry call sites and found
the mis-gate class already closed — every worker-held-verb gate either had
`isAdminRole` in the same expression or sat behind the admin instance. What was
actually still open was the *absent*-gate variant on `resolveSession()` exports:
`getDashboardData` (course.ts) and `getAvailableUsers` (enrollment.ts) had a
session check and nothing else, while the pages fronting them gated on
`course.read`. See [[gotcha_dashboard_two_actions_one_population]].

**How to apply:** when hunting RBAC holes, grep for `resolveSession`/
`getPortalSessions` first and audit every export in those files — including ones
no page calls, since a `'use server'` export is an HTTP endpoint regardless. Only
three of the 11 worker-held verbs are used as gates anywhere
(`course.read`, `organization.read`, `facility.read`); `certificate.read`,
`enrollment.edit`, `assessment.*` and `notification.*` have zero call sites, so
grepping for them finds nothing and that is not reassurance.

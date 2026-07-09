---
name: auth-instance-vs-role
description: The admin/worker auth "instance selector" is distinct from a user's DB role; conflating them causes routing/login bugs.
metadata:
  type: feedback
---

There are TWO separate concepts that both use `'admin' | 'worker'`-shaped values, and they must not be conflated:

1. **Auth instance selector** — which NextAuth instance / cookie / portal a session belongs to. Values stay `'admin' | 'worker'` and drive redirects (`/dashboard` vs `/worker`). Lives in: `src/app/actions/auth.ts` (`authenticate`), `src/lib/mfa-challenge.ts`, `src/app/actions/verify-mfa.ts` (`instance === 'worker'`), `createAuthInstance({ cookiePrefix })`. These are correct to keep as the binary literal — do NOT widen them to the six-role union.

2. **DB user role** — `UserRole` enum, six snake_case values (`owner`, `super_admin`, `hr`, `clinical_director`, `finance`, `worker`). Compared via `ADMIN_ROLES.includes(...)` / `isAdminRole()` / `isWorkerRole()` from `src/lib/rbac/role-utils.ts`.

**Why:** During the RBAC rollout, `role === 'admin'` appeared both as a real DB comparison (which had to become `isAdminRole(role)`) AND as an instance-selector comparison (which must stay). Blindly replacing all of them breaks login routing.

**How to apply:** Before changing a `role === 'admin'`/`'worker'` comparison, check whether the operand is a DB role (from a Prisma select or `session.user.role`) or an instance/mode flag. Only the former uses the RBAC helpers. The admin auth instance maps to `allowedRoles: ['owner','super_admin','hr','clinical_director','finance']`; the worker instance to `['worker']`. See [[rbac-role-model]].

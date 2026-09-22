---
name: auth-instance-vs-role
description: The admin/worker auth "instance selector" is distinct from a user's DB role; conflating them causes routing/login bugs.
metadata:
  type: feedback
---

There are TWO separate concepts that both use `'admin' | 'worker'`-shaped values, and they must not be conflated:

1. **Auth instance selector** — which NextAuth instance / cookie / portal a session belongs to. Values stay `'admin' | 'worker'` and drive redirects (`/dashboard` vs `/worker`). Lives in: `src/app/actions/auth.ts` (`authenticate`, `attemptPortal`), `src/lib/mfa-challenge.ts`, `createAuthInstance({ cookiePrefix })`, `src/proxy.ts`. These are correct to keep as the binary literal — do NOT widen them to the role union.

2. **DB user role** — `UserRole` enum, 14 snake_case values (6 manager-category, 8 worker-category; see [[rbac-role-model]]). Compared via `ADMIN_ROLES.includes(...)` / `isAdminRole()` / `isWorkerRole()` from `src/lib/rbac/role-utils.ts`.

**Why:** During the RBAC rollout, `role === 'admin'` appeared both as a real DB comparison (which had to become `isAdminRole(role)`) AND as an instance-selector comparison (which must stay). Blindly replacing all of them breaks login routing.

**How to apply:** Before changing a `role === 'admin'`/`'worker'` comparison, check whether the operand is a DB role (from a Prisma select or `session.user.role`) or an instance/mode flag. Only the former uses the RBAC helpers. The admin auth instance uses `allowedRoles: ADMIN_ROLES` (`src/auth.ts`); the worker instance uses `allowedRoles: WORKER_ROLES` but `sessionAllowedRoles: ALL_ROLES` (`src/auth.worker.ts`), so a manager bridged into Learn mode carries a manager role on the worker cookie — see [[gotcha_admin_auth_instance_is_the_tier_check]]. See [[rbac-role-model]].

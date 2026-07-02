---
name: rbac-role-model
description: Six snake_case DB roles; permissions.ts is the frozen registry; all snake↔camel conversion and role-set helpers live in src/lib/rbac/role-utils.ts.
metadata:
  type: project
---

RBAC model (rolled out on the `rbac` branch):

- **DB enum `UserRole`** (snake_case): `owner`, `supervisor`, `hr`, `clinical_director`, `finance`, `worker`. Replaced the old `admin | worker`. (An earlier draft used `super_admin`; it was dropped in favor of `supervisor` = facility overseer.) Migration maps `admin -> supervisor`; `scripts/backfill-roles.js` then promotes each org's earliest supervisor to `owner`.
- **`src/lib/rbac/permissions.ts`** is the authoritative permission registry (camelCase `RoleKey`s; only `clinicalDirector` differs from its snake_case DB value). Treat it as frozen except where a delta requires it. `supervisor` = `everythingExceptBilling` (all resources minus `billing.*`); `owner` = full `everything`. So `billing.*` holders = **owner + finance only**.
- **`src/lib/rbac/role-utils.ts`** is the ONLY place snake↔camel conversion happens (`dbRoleToRoleKey` — only `clinical_director→clinicalDirector` is non-identity), plus `ADMIN_ROLES`/`WORKER_ROLES`/`ALL_ROLES` (typed `readonly Role[]` so `.includes(role)` type-checks), `GRANTABLE_ROLES`, `getRoleDisplayName`, and predicates `isAdminRole`/`isWorkerRole`. Client-safe. NOTE: `isAdminRole`/`isWorkerRole` test DB roles — they do NOT recognize the legacy CSV token `'admin'`, so CSV-import role parsing must use a literal `entry.role === 'admin'` check, not `isAdminRole`.
- **`src/lib/rbac/authorize.ts`** — `authorize(permission)` route guard returning `{ ok, ctx }` or `{ ok:false, response }`. Adopted by the two billing routes (`invoices`, `overview`); other API routes still use inline `isAdminRole(...)` checks (full migration is a follow-up).

Key decisions baked in: `owner` is NON-grantable (removed from every `GRANTABLE_ROLES` array; set only at org creation) and is explicitly rejected as a target in `updateStaffDetails` (staff role-update) — but an existing owner keeping their role during a name edit is allowed. HR can grant hr/clinical_director/finance/worker (NOT supervisor/owner). Every role except `owner` consumes a plan seat (seat counts filter `role: { not: 'owner' }`). A new org founder (OAuth-no-invite, credentials onboarding, org creation) becomes `owner`. Facilities are not modeled yet — `supervisor` is role-only. See [[auth-instance-vs-role]].

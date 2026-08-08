---
name: gotcha-admin-role-unretired
description: `admin` is a live Owner-equivalent role again — do not reintroduce the "retired legacy admin" JWT guard or isAdminRole-based PII gates.
metadata:
  type: feedback
---

Two role-model facts that upstream `dev` code keeps contradicting, so they
resurface on every merge:

1. **`admin` is NOT retired.** The multi-org auth rework removed the
   `if (token.role === 'admin') return null` guard from
   `create-auth-instance.ts`. `admin` is a delegated Owner-equivalent seat with
   `permissions: everything`. Any incoming code or test asserting that an
   `admin` token is hard-rejected before the cache/DB lookup must be inverted,
   not merged.
2. **`isAdminRole()` is too coarse for PII gates.** `ADMIN_ROLES` includes
   `clinical_director` and `finance`, which hold no `user.read`. Where dev gates
   staff-roster PII on `isAdminRole(session.user.role)` (e.g. `getCourseById`'s
   enrolled-staff roster), re-express it as
   `can(dbRoleToRoleKey(session.user.role), 'user.read')` — `user.read` is the
   Staff Management permission and is the registry's own line between "may see
   other people's records" and "may only see their own".

**Why:** the first would log every admin out on deploy; the second would widen
PII exposure beyond the RBAC matrix (which is FROZEN — see
[[rbac_role_model]]).

**How to apply:** when merging anything from `dev` that touches auth callbacks
or admin-tier gates, grep the incoming diff for `'admin'` literals and
`isAdminRole` before accepting it.

---
name: gotcha-revalidation-cache-is-identity-only
description: The JWT session-revalidation Redis cache stores IDENTITY fields only — never role/organizationId, which must stay a live per-decode membership read.
metadata:
  type: feedback
---

`src/lib/auth/session-revalidation-cache.ts` caches only identity-level fields
(`id`, `fullName`, `mfaEnabled`, `passwordResetRequired`, `sessionVersion`,
`authProvider`). Never add `role` or `organizationId` to `RevalidationSnapshot`.

**Why:** the cache key is the user id, but role and organization live on the
per-org `OrganizationUser` membership. A multi-org user acting in org A would
warm the key with org A's role, and a later decode of their org B token would
read it back — a cross-tenant privilege bleed. It also means a deactivated
membership would be masked for the whole TTL. The upstream `dev` branch's
version of this cache DID store role/organizationId, because pre-split those
were columns on `users`; that shape must not be reintroduced on merge.

**How to apply:** in `create-auth-instance.ts`'s `jwt()` callback, the identity
read may come from the cache, but `getActiveMembership()` is always called live
when `token.organizationId` is set (see the "MEMBERSHIP IS NEVER CACHED" note
there). Keep both `invalidateRevalidationCache()` call sites (role change, staff
removal, both password-reset paths, self-service change) passing the IDENTITY id
— `staffOrgUser.userId` / `target.userId`, never the organizationUserId the
action was called with. Related: [[rbac_role_model]], [[org_facility_split]].

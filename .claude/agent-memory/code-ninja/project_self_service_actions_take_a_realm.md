---
name: project-self-service-actions-take-a-realm
description: Self-service writes name their portal explicitly (getRealmSession, no fallback); a user-supplied storage URI is a read-anything primitive because getSignedUrl signs by key alone
metadata:
  type: project
---

**Realm, not referer (BUG-05, 2026-09-28).** `updateProfile`, `uploadAvatar` and
`changePassword` (`src/app/actions/user.ts`) take `realm: PortalRealm` as their
FIRST argument and resolve exactly that portal via `getRealmSession()` in
`src/lib/auth/portal-sessions.ts` — no referer sniffing, no fallback to the
other portal. `ChangePasswordTab` has a required `realm` prop.

**Why:** one browser can hold an admin cookie and a worker cookie for two
DIFFERENT accounts; any "prefer admin, fall back to worker" helper can write to
the wrong account. `notifications.ts`, `mfa.ts`, `course.ts`, `enrollment.ts`,
`offering.ts`, `certificate.ts` still carry an admin-first `resolveSession()` —
same class, not yet fixed.

**How to apply:** a new self-service write takes a realm from the caller and
validates it with `isPortalRealm` (Server Action args are unchecked). Admin-only
screens use `auth()` from `@/auth` directly.

**Storage URIs from the client (RISK-02).** `getSignedUrl` in both providers
signs `parseStorageUri(uri).key` against the configured bucket, ignoring the
bucket in the URI. So storing a caller-supplied URI that a page later signs lets
the caller read ANY object (another tenant's document). `updateProfile` now
accepts only keys under `avatars/<userId>/`. Apply the same ownership check to
any other action that persists a client-sent storage URI. See
[[gotcha-server-action-args-are-unchecked]].

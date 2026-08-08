---
name: proxy-cookie-lags-membership
description: The proxy routes on the raw session cookie (no auth callbacks), so any gate keyed on token.organizationId needs a client-side update() or it bounces users on stale cookies.
metadata:
  type: project
---

`src/proxy.ts` decodes the session JWT directly — it never runs the NextAuth callbacks — so it sees whatever the cookie last stored, not the live DB. The jwt callback (and therefore the cookie) is only re-run when a request hits `auth()` or the `/api/auth/session` endpoint.

**Why:** the org-less → onboarding gates (worker and, since the multi-facility staging fixes, admin) key off `token.organizationId`. A user whose membership was created after the cookie was minted (finished onboarding in another tab, accepted an invite, session refresh failed) carries an org-less cookie and gets redirected into onboarding even though they are fully onboarded.

**How to apply:** whenever a proxy gate depends on a claim that server-side state can change, pair it with a client-side re-mint:
- the jwt callback adopts a newly created membership for org-less tokens (see `activeMembershipOf` usage in `create-auth-instance.ts`), and
- a client component calls next-auth's `update()` **before** navigating (`/onboarding/complete`, `OnboardedRedirect`), because only the `/api/auth/session` round-trip can write the new cookie.

Verified locally: `/dashboard` with a stale org-less cookie goes `/dashboard → /onboarding/step1 → /dashboard` and settles — never loops — because the onboarding layout re-mints before it redirects. Removing the re-mint turns that into an infinite bounce. See [[local-ui-verification]], [[auth-instance-vs-role]].

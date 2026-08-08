---
name: gotcha-server-action-redirectto-must-render
description: A Server Action's redirectTo must name a route that RENDERS — any further redirect on the target (middleware gate OR a server-component redirect() like /onboarding → /onboarding/step1) crashes the client with Next.js E394.
metadata:
  type: project
---

**Rule:** whatever a Server Action passes as `redirectTo` (or throws via `redirect()`)
must be a route that **renders a page**. If the target answers with *another* redirect,
the browser transparently follows it and hands the client an HTML document where it
expected the action's flight payload — the client throws
`Error: An unexpected response was received from the server` (`__NEXT_ERROR_CODE: E394`)
instead of navigating, and the nearest `error.tsx` shows "Something went wrong".

**Why:** verified empirically on a production build. The action POST response looks like:

```
POST /login  (next-action: ...)
→ 303  location: /onboarding/step1
       x-action-redirect: http://localhost:3005/onboarding;push
       content-type: text/x-component
→ GET /onboarding/step1 → 200 text/html   ← client expected text/x-component
```

The `location` header is the tell. A healthy action redirect has **no** `location` — only
`x-action-redirect` — and the router navigates itself.

Both known triggers produce the identical shape:
- a **middleware gate** in `src/proxy.ts` re-routing the target (org-less admin
  `/dashboard/*` → `/onboarding`), and
- a **server component `redirect()`** on the target itself (`src/app/onboarding/page.tsx`
  is a bare `redirect('/onboarding/step1')` stub).

Fixing only the first still crashes on the second — they must both be designed out.

**How to apply:** when writing or changing any Server Action's redirect target, walk the
target route and confirm it renders: check `src/proxy.ts`'s gates for that path, and open
the target's `page.tsx` for a top-level `redirect()`. Prefer the concrete leaf route
(`/onboarding/step1`) over an index that forwards (`/onboarding`). A hard `page.goto()` in
a test does NOT reproduce this — only the Server-Action-driven soft navigation does, so an
e2e that navigates directly will pass while the real login flow is broken. Reproduce with a
tiny Playwright script that logs `response.headers().location` on the action POST.

`src/proxy.ts` additionally skips its onboarding gates for Server Action requests
(`POST` + a `next-action` header) as defense in depth; the auth/role/MFA gates are
deliberately NOT skipped. Related: [[gotcha_proxy_cookie_lags_membership]],
[[auth_instance_vs_role]], [[gotcha_secure_cookie_delete_and_prod_e2e]].

---
name: gotcha-secure-cookie-delete-and-prod-e2e
description: __Secure- cookie deletions need the Secure attr (cookies().delete omits it); next dev masks prod-only cookie/image bugs that next start exposes in CI e2e.
metadata:
  type: project
---

Two prod-only (`next start`) gotchas that `next dev` hides — the CI "E2E (Playwright)" job runs a production build (`npm run build` + `npm run start -- -p 3005`, see `webServer` CI branch in `playwright.config.ts`), so it catches these while local dev runs don't.

**1. Deleting a `__Secure-` prefixed cookie must carry the `Secure` attribute.**
- In prod (`NODE_ENV=production`) the session cookies are named `__Secure-{admin,worker}.session-token` with `secure:true` (see `useSecureCookies` in `src/lib/create-auth-instance.ts`). In dev they're plain `{admin,worker}.session-token`.
- `cookies().delete(name)` / `cookieStore.delete(name)` emits `Set-Cookie: name=; Expires=…` **without** `Secure`. Per RFC 6265bis §4.1.3.1 the browser silently **rejects** a `__Secure-` prefixed Set-Cookie that lacks `Secure`, so the deletion never lands in prod — while dev (plain names) works. This masked a real sibling-session-cookie clearing bug (login sibling-clear + logout `clearSiblingSessionCookie`).
- Fix pattern: expire via an explicit `cookieStore.set(name, '', { path:'/', httpOnly:true, sameSite:'lax', secure: name.startsWith('__Secure-'), expires:new Date(0), maxAge:0 })`. Shared helper: `expireSiblingSessionCookies()` in `src/lib/auth/session-cookies.ts`.
- **How to apply:** any time you delete/clear an auth cookie, verify the emitted `Set-Cookie` under `next start` (not just `next dev`) — inspect the actual header; a bare `delete()` is not enough for `__Secure-`/`__Host-` names.

**2. `next start` image-optimizer coalescing deadlock.**
- `/onboarding-worker` (`src/app/onboarding-worker/page.tsx`) renders `<Image src="/images/login-bg.png" priority quality={100} fill>` on a 6.5MB PNG. When the org-less-worker login redirect (`/worker` → `/onboarding-worker`) aborts the in-flight `/_next/image?...w=1920&q=100` optimization, the page's duplicate request for the same cache key coalesces onto the aborted generation and **hangs forever** (reproduced: a 2nd request for the same uncached image after aborting the 1st returns `http=000` at 30s; curl warm/cold alone = 1.4s). This makes `page.goto(..., {waitUntil:'load'})` time out. Framework-level, unrelated to auth. Remediations: drop `quality={100}` / use a smaller optimized asset / don't mark it `priority`, or have the e2e use `waitUntil:'domcontentloaded'`.

**CI env quirks to mirror when reproducing prod e2e locally** (from `.github/workflows/ci.yml` e2e job): sets `AUTH_URL`/`NEXTAUTH_URL=http://localhost:3005` (activates `reqWithEnvURL`), `E2E_TEST_BYPASS_RATE_LIMIT=true`, dummy `AUTH_MICROSOFT_ENTRA_ID_*`. The dummy Entra creds cause a harmless, caught `[auth][error] TypeError: ...reading 'replace'` from `@auth/core/providers/microsoft-entra-id.js` (`json.issuer.replace` when OIDC discovery of the bogus tenant returns no `issuer`) — third-party, OAuth-path only, not the credentials login path.

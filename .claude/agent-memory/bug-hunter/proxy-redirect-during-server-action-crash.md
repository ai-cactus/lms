---
name: proxy-redirect-during-server-action-crash
description: A middleware (proxy.ts) redirect to a DIFFERENT route than a Server Action's own redirectTo crashes the client with Next.js error E394 ("unexpected response from server") — found via the multi-facility staging-fix batch's new admin org-less gate, 100% reproducible
metadata:
  type: project
---

**The bug:** `authenticate()` (`src/app/actions/auth.ts`) is a Server Action that calls
NextAuth's `signIn('credentials', { redirectTo: '/dashboard' })` for an org-less admin
(`homePath` is always `/dashboard`/`/worker`, never the onboarding path, regardless of
whether the account has an organization yet). When `src/proxy.ts` ALSO has a gate that
intercepts that exact target route and 307-redirects it elsewhere (e.g. the admin
org-less-session gate added in the multi-facility staging-fix batch: `/dashboard/*` with no
`organizationId` → `/onboarding`), the browser's client-side handling of the Server
Action's own redirect instruction crashes: `Error: An unexpected response was received from
the server.` (Next.js internal error code `E394`), caught by the nearest `error.tsx`
boundary — which for `/login` is the `(auth)` route group's, so the user sees a "Something
went wrong" screen still showing the login page's decorative hero image, stuck exactly where
they submitted the form.

**Reproduced 100% in isolation** (not a full-suite flake — reran the single test alone, same
crash every time) against a **production build** (`next build && next start -p 3005`,
mirroring CI, not `next dev`) with `AUTH_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL`/`APP_URL`
all correctly set to `:3005` — ruled out every known local-env trap
([[e2e-local-auth-url-env-trap]], [[ui-updates-reconciliation-e2e-env-fixes]]) before
concluding this was a real product regression, not environment noise.

**Scope, confirmed via full-suite run:** breaks EVERY e2e test that logs a genuinely
org-less admin-tier account in through the real login FORM — all 7 pre-existing tests in
`tests/e2e/onboarding-wizard.spec.ts` (the file's `login()` helper hits this on literally
every call) plus 2 in `tests/e2e/rbac-removed-staff-login.spec.ts` (`org-less OWNER login`,
`genuinely memberless identity`) — 9 failures total out of 140 in the full suite, all this
one root cause. Does NOT affect already-onboarded admin logins (their `redirectTo` and the
proxy's post-decode `organizationId` agree, so no gate fires) — confirmed clean by ~130
other passing tests across rbac/reminders/settings/billing specs that log in seeded,
already-onboarded accounts.

**Diagnostic technique that isolated it:** a `page.goto()` HARD navigation (not through the
Server Action) to the exact same gated route, with the session cookie minted directly via
`page.request.post('/api/auth/callback/credentials', ...)` (bypassing the login form
entirely), redirects CLEANLY with no crash — proving the proxy gate's redirect LOGIC is
correct and the bug is specifically in the Server-Action-triggered client-side RSC
navigation's handling of a middleware redirect to a different route, not in `proxy.ts`'s
branching itself. This pattern (mint the cookie via a direct API POST to bypass a broken/
suspect UI flow, then `page.goto()` the target) is reusable whenever you need to test a
proxy/middleware gate in isolation from the login flow that normally reaches it.

**Also surfaces stale pre-existing test assumptions**: `rbac-removed-staff-login.spec.ts`'s
two failing tests were written against the PRE-diff behavior (their own comments say so
explicitly: "the admin portal does not route org-less users away from /dashboard at the
proxy layer — `OrganizationActivationModal` instead shows a welcome dialog on /dashboard
itself"). The new proxy gate supersedes that modal-on-dashboard approach with a direct
redirect to `/onboarding`, so `OrganizationActivationModal`
(`src/components/dashboard/OrganizationActivationModal.tsx`) is now effectively unreachable
for the org-less-admin welcome case (dead code, not yet removed). Once the crash itself is
fixed, these two tests will ALSO need their assertions updated to expect `/onboarding`
instead of a `/dashboard` + modal — a second, independent follow-up beyond just the crash
fix.

**How to apply:** whenever a proxy/middleware gate is added or changed for a route that a
Server Action's own `redirectTo`/`signIn(..., { redirectTo })` can also target, check whether
the two can disagree (Server Action says land on X, middleware then re-routes X → Y) — that
combination is exactly what triggers this class of crash. Either the Server Action should
compute the FINAL correct destination itself (skip the middleware round-trip), or this needs
a real Next.js-level fix; either way this is a `code-ninja` fix, not a test fix. See
[[onboarding-invite-settings-phase-tests]] and [[project-rbac-proxy-bug]] for other
proxy/RBAC-adjacent regressions found by this project's e2e suite.

**This is not a brand-new failure mode — the WORKER side of the exact same gate already
exhibited a milder version of it, worked around rather than fixed.**
[[qa-issue-2-4-and-csv-fix-tests]] (an earlier session, pre-dating the admin gate) documents
that the pre-existing org-less-WORKER proxy gate (`/worker` + no `organizationId` →
`/onboarding-worker`) could "visibly stick" without redirecting even after 45s on the FIRST
client-side landing right after `signIn()`, confirmed via raw `curl` that the server-side 307
itself fires fine — same root cause (Server-Action-triggered soft navigation vs. a
middleware redirect to a different route), same trigger shape. That session's fix was a
test-side workaround (force a hard `page.goto()` after the stuck `waitForURL`), not a report
back to the product code, because a silent multi-second stall is easy to paper over in a
test. The NEW admin gate makes the SAME underlying issue manifest as an outright, unrecoverable
client crash instead of a slow stall — which is why this time it must be routed back to
`code-ninja` rather than worked around again. If a future session touches the worker gate
again, revisit whether it deserves the same fix rather than another test-side patch.

**RESOLVED** (same day, follow-up commit): `code-ninja` fixed this at the source rather than
patching the proxy alone — `authenticate()`/`authenticateWorker()` now compute the correct
LEAF destination directly (`/onboarding/step1` / `/onboarding-worker`, not `/dashboard` /
`/worker`) for a membership-less login, on the documented principle that **a Server Action's
`redirectTo` must name a route that renders, never one that itself answers with another
redirect** (middleware OR a server component's own `redirect()`, e.g. `/onboarding`'s stub
redirecting to step1). `src/proxy.ts` additionally now skips its onboarding-locus gates for
Server Action POSTs (detected via the `next-action` header), deferring them to the ordinary
GET/RSC navigation that follows — auth/role/MFA gates are deliberately NOT deferred, since
those must still deny the action itself. Re-ran the FULL e2e suite from a clean slate
(fresh prod build, reseed, Redis flush) after the fix: **137 passed, 1 flaky (self-recovered
on retry, unrelated pre-existing signup-form locator ambiguity — see
[[local-production-build-e2e-run]]), 3 skipped, 0 hard failures** out of 141 tests — both
previously-failing files (`onboarding-wizard.spec.ts`, `rbac-removed-staff-login.spec.ts`)
fully green, confirming the fix and no new regressions from the proxy/auth-action changes.

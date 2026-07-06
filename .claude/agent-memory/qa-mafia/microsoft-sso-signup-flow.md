---
name: microsoft-sso-signup-flow
description: Production Microsoft/Entra SSO signup flow — OAuth handoff details, personal-account acceptance, and a role-selection redirect bug
metadata:
  type: project
---

**Production Microsoft SSO signup validated 2026-07-01** (Phase 2, `qa-reports/phase-2-microsoft-sso.md`). Button on `/signup` is labeled exactly **"Sign up with Microsoft"**, above the "or continue with email" divider — same button also seems to serve sign-in (NextAuth provider id `microsoft-entra-id`).

**Tenant is `common`, not a restricted Entra tenant** — the OAuth `authorize` URL uses `tenant=common`, meaning **personal/consumer Microsoft accounts (even Gmail-domain ones) are accepted**, not rejected. Don't assume Entra work/school restriction without re-checking — this app's registration allows both. If asked to test the "personal account rejected" contingency, that contingency did NOT reproduce here — file it as accepted/PASS, not FAIL.

**Microsoft's own login UI for a personal account defaults to passwordless "Get a code" (email OTP).** To use a provided password instead: click **"Other ways to sign in"** → **"Use your password"** → enter password → Next. No MFA/OTP challenge appeared for the tested account (`<test-sso-account>`), and no OAuth consent/permissions screen appeared either (possibly pre-consented app registration) — only a "Stay signed in?" prompt (click No/Yes, either is fine, doesn't affect app-side outcome for a throwaway test session).

**KNOWN BUG — confirmed reproducible (2026-07-01):** After OAuth callback, the app redirects to `/signup/role-selection`, but that page **immediately self-redirects (client-side) back to the public `/signup` form** — even though the session is already fully authenticated (confirmed via `/api/auth/session` showing `role: "admin"`, `authProvider: "microsoft-entra-id"`). This happens both on the live OAuth redirect AND on a fresh manual `goto` to `/signup/role-selection` while authenticated — 100% reproducible, not a timing fluke. Network trace: `GET /api/auth/session` (200) immediately followed by client nav to `/signup?_rsc=...`. Likely a route-guard bug: sees the OAuth session already has a role assigned and bounces away from role-selection, but targets the wrong destination (`/signup` instead of `/dashboard`).

**Workaround/escape valve that DOES work:** manually navigating to `/dashboard` works fine even in this state — full dashboard renders correctly with the OAuth user's real name, and shows the same "Welcome to the Compliance and Training Management portal" → "Activate your account" modal seen in the email-signup flow (see [[production-env-access]]), which correctly routes to `/onboarding/step1`. So a Microsoft-OAuth signup is NOT actually blocked/broken end-to-end — only the `/signup/role-selection` intermediate page is broken as a landing target.

**Session shape for an OAuth-created account:** `{"user":{"name":..., "email":..., "role":"admin","organizationId":null,"authProvider":"microsoft-entra-id","mfaVerified":true,"mfaEnabled":false,"sessionId":...}}` — role is pre-assigned to admin immediately (no explicit Admin-vs-Worker choice step actually completes for OAuth users, unlike the email flow where `/signup/role-selection` is the real account-creation step per [[production-env-access]]).

**No console errors observed anywhere in the OAuth handoff or landing screens** — only pre-existing, unrelated warnings (Recharts chart width/height 0 on `/dashboard`, Radix missing Dialog Description on the activation modal).

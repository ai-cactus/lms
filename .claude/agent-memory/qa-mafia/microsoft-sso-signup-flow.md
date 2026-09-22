---
name: microsoft-sso-signup-flow
description: Production Microsoft/Entra SSO signup flow — OAuth handoff details (tenant=common, personal accounts accepted), Microsoft password-sign-in path; old role-selection redirect bug is moot (route removed)
metadata:
  type: project
---

**Production Microsoft SSO signup validated 2026-07-01** (Phase 2, `qa-reports/phase-2-microsoft-sso.md`). Button on `/signup` is labeled exactly **"Sign up with Microsoft"**, above the "or continue with email" divider — same button also seems to serve sign-in (NextAuth provider id `microsoft-entra-id`).

**Tenant is `common`, not a restricted Entra tenant** — the OAuth `authorize` URL uses `tenant=common`, meaning **personal/consumer Microsoft accounts (even Gmail-domain ones) are accepted**, not rejected. Don't assume Entra work/school restriction without re-checking — this app's registration allows both. If asked to test the "personal account rejected" contingency, that contingency did NOT reproduce here — file it as accepted/PASS, not FAIL.

**Microsoft's own login UI for a personal account defaults to passwordless "Get a code" (email OTP).** To use a provided password instead: click **"Other ways to sign in"** → **"Use your password"** → enter password → Next. No MFA/OTP challenge appeared for the tested account (`<test-sso-account>`), and no OAuth consent/permissions screen appeared either (possibly pre-consented app registration) — only a "Stay signed in?" prompt (click No/Yes, either is fine, doesn't affect app-side outcome for a throwaway test session).

**Historical (2026-07-01):** after the OAuth callback, the app used to send users to a `/signup/role-selection` page that bounced back to `/signup`. That route no longer exists; signup is owner-only, with no role-selection step (see [[lms-v2-signup-onboarding-settings-flow]]). Re-verify where an OAuth signup lands before asserting it.

**Session shape for an OAuth-created account:** `{"user":{"name":..., "email":..., "role":"admin","organizationId":null,"authProvider":"microsoft-entra-id","mfaVerified":true,"mfaEnabled":false,"sessionId":...}}` — role was pre-assigned immediately, with no Admin-vs-Worker choice step (as of 2026-07-01; self-serve signup now always mints `owner`).

**No console errors observed anywhere in the OAuth handoff or landing screens** — only pre-existing, unrelated warnings (Recharts chart width/height 0 on `/dashboard`, Radix missing Dialog Description on the activation modal).

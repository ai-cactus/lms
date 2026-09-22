---
name: production-env-access
description: Production LMS URL, signup → verify-email flow (no role-selection step), two-step email verification, and cautions for sending real invites on production
metadata:
  type: reference
---

**Production URL:** https://training.theraptly.com/ — distinct from [[staging-env-access]]'s staging-lms.theraptly.com. Landing page has "Sign in" (top-right) and "Start for free →" (hero + repeated CTAs) linking to `/login` and `/signup` respectively.

**Email signup (2026-07-01 flow, updated 2026-09-21):** `/signup` → `/verify-email`.
1. `/signup` asks for First Name, Last Name, Email, Password, Confirm Password and a Terms checkbox (a Radix checkbox, same pattern as [[signup-test-patterns]]). A live password-strength checklist shows 12+ chars, upper, lower, number and special char. Submit stays `disabled` until every field is valid.
2. `/verify-email` ("Check your email") says the link expires in 24 hours and offers "Resend Email". Verification is link-based.

The old `/signup/role-selection` step no longer exists; it is on neither `dev` nor `main`. Signup is owner-only; workers join via invite.

**No org/company field appears anywhere in this 3-step signup — confirmed (2026-07-01) it's collected post-verification instead.** After email verification + first login, `/dashboard` shows a mandatory-looking modal ("Welcome to the Compliance and Training Management portal") with a single "Activate your account" CTA. **This modal is NOT reliable/reproducible** — it appeared on the very first post-verification dashboard visit but did NOT reappear on a subsequent fresh login/reload before onboarding was completed (console showed a different `[ModalContext] Activating modal: dashboardEmptyState` instead). Don't rely on it as a gate — navigate directly to `/onboarding/step1` to reach the wizard regardless of whether the modal shows.

**Onboarding wizard:** the `/onboarding/step1..` wizard now has 5 steps (`src/app/onboarding`). The 2026-07-01 walkthrough of the older version is in `qa-reports/phase-1b-onboarding-activation.md`. Snapshot each step rather than relying on remembered field lists. Invited emails appear on `/dashboard/staff` as "Pending Invite". That is the reliable way to confirm an invite was created; the dashboard's staff stats count course-assigned staff only.

**Recurring cosmetic warning:** every `<Select>`/combobox interaction in the onboarding wizard fires a React "Select is changing from uncontrolled to controlled" console warning — harmless (values submit correctly) but appears throughout steps 1–3.

**CAUTION when completing this wizard on production:** step 4/5 (invites) sends real invite emails and creates a "Pending" staff-management entry — only do this with explicitly authorized, watched test addresses (e.g. `+staff1@`/`+worker1@` plus-addressed variants of a controlled inbox), and only when the user has explicitly authorized inviting real-looking addresses on production.

**Email verification is a two-step confirm, not an auto-verify-on-link-click:** visiting the emailed link (`/api/auth/verify?token=...`) 307-redirects to `/verify?token=...`, an interstitial "Welcome to Theraptly" page requiring an explicit "Verify Email Address" button click. That fires `POST /api/auth/verify` (200) and redirects to `/login?verified=true` with a green "Email verified successfully!" alert.

**Unverified-account login** is blocked with a disambiguating "Please verify your email to sign in." The old generic "Invalid credentials." copy issue is fixed on `main`.

**Gmail plus-addressing (`+suffix@gmail.com`) is accepted without validation issue** on the production signup email field — safe pattern for generating fresh test emails against one watched inbox.

**Cloudflare challenge-platform network call** (`POST /cdn-cgi/challenge-platform/...`) fires silently during signup with a 200 — no visible CAPTCHA/user-facing challenge blocking the flow as of 2026-07-01.

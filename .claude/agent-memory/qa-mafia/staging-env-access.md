---
name: staging-env-access
description: How to reach the staging LMS, login flow, and key UI landmarks for browser automation
metadata:
  type: reference
---

**Staging URL:** https://staging-lms.theraptly.com/

**Login page:** https://staging-lms.theraptly.com/login (reached via "Sign in" top-right nav on landing page, or directly)

**Auth method:** Email + password form (also Microsoft SSO available, untested). No CAPTCHA observed on staging.

**Post-login redirect:** Authenticated users land on `/dashboard`. Admin role gets sidebar with Dashboard, Documents, Courses, Staff Management, Audit Reports, Billing. Worker role destination not yet observed.

**Session behavior:** Session persists across SPA navigation and hard page reload (Cmd+Shift+R). Session cookie/token survives browser cache bust. However, authenticated users visiting `/login` are NOT redirected to dashboard — login form is shown (middleware gap, low severity).

**Test accounts:** live QA is self-service. Use the D01/B4 fixture orgs. For accounts and current credentials, see [[staging-two-facility-fixture-recipe]]. To create a new account, sign up with a plus-addressed QA Gmail alias.

**Key UI refs on login page (as of 2026-06-26):**
Note: playwright-cli ref IDs are session-scoped and change across sessions. Use role-based locators instead:
- Email input: `getByRole('textbox', { name: 'Email' })`
- Password input: `getByRole('textbox', { name: 'Password' })`
- Submit button: `getByRole('button', { name: 'Log in', exact: true })` — disabled when either field empty
- Forgot password link: `getByRole('link', { name: 'Forgot your password?' })` → /forgot-password
- Sign Up link: `getByRole('link', { name: 'Sign Up' })` → /signup

**Wrong-password error:** "Invalid credentials." in red beneath email field + red border on email field. Generic (does not reveal which field was wrong — security best practice).

**Onboarding panel on dashboard:** A getting-started panel ("Turn Your Healthcare Policies into Interactive Training in Minutes") is present in the main dashboard content. On 2026-06-26 no blocking modal appeared — the panel is inline content, not a modal overlay.

**Fixed security defect (historical):** the login client once logged the raw plaintext password to the console (`[Login Client] Submit clicked!`). It is FIXED and pinned by a regression test in `src/app/(auth)/login/page.test.tsx`. Still worth a glance at the console on any new auth flow.

**UPDATE 2026-07-14 — unverified-login error message has changed (staging).** Attempting to log in with the correct email+password of a not-yet-verified account now shows a clear, disambiguating **"Please verify your email to sign in."** message (not the old generic "Invalid credentials." noted for production in [[production-env-access]]). This is a real behavior/copy difference between staging and production as of this date — don't assume they match.

**Profile page:** `/dashboard/profile` uses a left-sidebar pill-tab shell (each pill is a `<button role="tab">`). The manager view has extra "My Organization" / "My Facilities" pills, and 2FA has its own tab. Read the tab names from a snapshot rather than assuming them.

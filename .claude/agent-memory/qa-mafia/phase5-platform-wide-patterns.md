---
name: phase5-platform-wide-patterns
description: 2FA is email-OTP (not TOTP); the 2026-07-17 MFA bugs and Help Center no-search are all FIXED; InactivityTimer mechanics and how to test it fast
metadata:
  type: reference
---

**Full report:** `qa-reports/phase5-platform-wide.md` (2026-07-17, LOCAL, branch `rbac`) — verdict FAIL at the time (38/43). Both blockers, the 2FA login flow and Help Center search, have since been fixed.

## 2FA is email-OTP, not TOTP

The only reachable 2FA UI is the Profile 2FA tab. It creates `mfa_factors` rows with `type: 'email'`. Setup and disable both email a 6-digit code (subject "Your Theraptly LMS verification code"); grab it from MailHog like any other OTP. The dead TOTP `MfaSettings.tsx` component has been deleted. If a future story assumes TOTP/QR-code 2FA, correct it to email-OTP or flag the mismatch; don't silently reinterpret the story.

**Every 2FA bug this run found is FIXED:**
- **Double challenge:** the legacy `/verify-2fa` page and action are gone. An unverified MFA session now goes back to `/login` (`src/proxy.ts`).
- **A wrong code burned the challenge:** `/api/auth/mfa/verify` now checks the code and stamps the session *before* `redeemMfaChallenge`.
- **Duplicate OTP emails on page load:** `(auth)/mfa/verify/page.tsx` guards send-on-mount with `didSendRef`.
- **Rate limit silently swallowed:** `/api/auth/mfa/send` now returns 429 with the error. `sendLoginMfaCode` still overwrites one `mfa_factors.secret` row per send, so when several emails are close together, only the latest one's code is valid.
- **QA unblock, if the 3/15-min send limit is hit locally:** `docker exec lms-dev-redis redis-cli DEL "mfa-send:<userId>"`.

## Help Center (`/dashboard/help`)

Fixed 2026-07-27 (`0bcebc3`). `HelpCenterContent.tsx` has a client-side searchbox ("Search help articles…") that filters the FAQ entries, with a "No results found" empty state. The FAQ copy is still flagged in source as placeholder and is learner-scoped. The OTP email's expiry copy is derived from `OTP_EXPIRY_MINUTES`.

## InactivityTimer (client-side session-timeout) — mechanics + fast test recipe

`src/components/providers/InactivityTimer.tsx`: `TIMEOUT_MS = timeoutMinutes*60000` (default 60, via `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES`), `WARNING_MS = (timeoutMinutes - warningMinutes)*60000` (`warningMinutes` hardcoded to 2), a `setInterval` check every 30s (`checkInterval`) compares `Date.now() - lastActivityRef.current` against these. Once the warning threshold is crossed, a **separate 1-second client-side countdown interval** takes over and fires `handleLogout()` (→ `signOut({callbackUrl:'/login'})`) at exactly `TIMEOUT_MS` — so the final expiry redirect is precise (confirmed exactly 180.000s for a 3-minute config), not subject to the 30s check granularity; only the *warning's first appearance* has up to ~30-90s of slack. Activity listener: `['mousedown','keydown','scroll','touchstart','click']` on `document`, passive. Login page shows a "Session Expired" alert ("You were logged out due to inactivity.") when landing there via this path — useful as a positive-confirmation signal distinct from a generic redirect.

**To test this fast:** ask the orchestrator to set `INACTIVITY_TIMEOUT_MINUTES` + `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES` to ~3 and restart the dev server (qa-mafia should never change env/config itself). At 3 min: warning appears ~60s idle (countdown starts at "2:00"), expiry+redirect at exactly 180s idle. **Do the whole wait inside ONE synchronous `playwright-cli run-code` script** (`page.waitForSelector('text=Session Expiring Soon', {timeout:...})` then `page.waitForURL('**/login**', {timeout:...})`) rather than a backgrounded shell `sleep` — see [[long-wait-tests-must-stay-synchronous]] for why. For the "activity resets the timer" case, dispatch a real harmless keypress (e.g. `page.keyboard.press('Shift')`) every ~45s in a loop inside the same script — `waitForTimeout` alone does NOT count as activity since it doesn't dispatch a DOM event the listener sees.

See also [[local-dev-env-setup]] for the general MailHog/DB access pattern, [[lms-v2-signup-onboarding-settings-flow]] for the Settings gate (`organization.edit` — Owner/Admin/HR), [[lms-v2-signup-onboarding-settings-flow]] for the onboarding wizard needed to reach a usable Settings/Profile page.

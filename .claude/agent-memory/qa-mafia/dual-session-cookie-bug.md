---
name: dual-session-cookie-bug
description: Logging in as a different-role-category account does not clear the other auth namespace's session cookie -- two different users' sessions can coexist in one browser (found 2026-07-14 on staging)
metadata:
  type: project
---

**Found 2026-07-14 on staging (https://staging-lms.theraptly.com), reported as ISSUE 4 in `qa-reports/phase1-foundation.md`.** The app uses two separate NextAuth cookie namespaces — `__Secure-admin.session-token` for manager-category logins and `__Secure-worker.session-token` for worker-category logins (this dual-cookie split is the same mechanism documented in [[lms-v2-signup-onboarding-settings-flow]]'s Manage/Learn bridge notes). Logging in via the shared `/login` form only sets/replaces the cookie for the category matching the account's own role — it does **not** clear a pre-existing session cookie from the *other* category, even when that prior session belongs to a completely different user account.

**Repro:** log in as a manager-category account (e.g. Finance) → without logging out, go back to `/login` and log in as an unrelated worker-category account (e.g. Nurse, correctly routes to `/worker`) → navigate directly to `/dashboard`. Result: `/dashboard` renders as the **original Finance account** (confirmed via `/api/auth/session` returning Finance's full identity), while `/worker` simultaneously serves the Nurse identity (confirmed via `/api/auth-worker/session`). Both cookies are valid and concurrently active for two different users in one browser.

**This is NOT a privilege-escalation bug** — the worker's own login didn't gain them anything; the *prior* admin user's own session simply never got torn down. But it's a real session-hygiene gap: on a shared/kiosk browser, one person's admin session can remain silently reachable after someone else logs in through the same form, with no visible signal that this happened.

**Verified the underlying route guard itself is correct**, not the source of the bug — manually clearing the stale `__Secure-admin.session-token` cookie (`page.context().clearCookies({ name: '__Secure-admin.session-token' })`) immediately restores correct behavior: `/dashboard` then redirects a worker session to `/login` as expected.

**QA methodology implication — apply this on every future RBAC pass:** when driving sequential same-browser logins across manager ↔ worker role boundaries (e.g. testing "can Nurse reach `/dashboard`" right after having tested a manager role), **manually clear the other category's session cookie before asserting an out-of-scope block**, or the stale session will silently mask/pass a test that should have failed. Same-category transitions (manager→manager, e.g. Supervisor→HR→Finance) correctly replace each other with no such issue — this only bites when crossing the admin/worker boundary.

See [[rbac-role-grant-matrix]] for the full role permission matrix this was found while testing.

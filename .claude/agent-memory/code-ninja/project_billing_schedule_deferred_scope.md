---
name: billing-schedule-deferred-scope
description: Known-but-deliberately-unfixed billing bugs left out of the 2026-08-25 cancel/resume/seats fix — checkout's missing pausedAt check, proration (#27), deferred pause start (#28)
metadata:
  type: project
---

The `bugfix/billing-cancel-resume-seats` work (2026-08-25) deliberately left three
known billing defects unfixed:

- **`checkout/route.ts` has no `pausedAt` check**, so a paused org can schedule a
  plan change. That is the state that produced bug #29 (paused org could not
  resume). It was declared out of scope — the fix was made on the *resume* side
  (auto-release the schedule) instead.
- **#27 plan-change proration** and **#28 deferred pause start** — explicitly
  deferred by the user, not oversights.
- **`pause/route.ts` keeps its hard 409** on a pending `stripeScheduleId` while
  cancel/resume/reactivate auto-release. This asymmetry is a product decision,
  not an inconsistency to "clean up".

Also decided: **a consumed seat = every active `OrganizationUser`, owner and
managers included** (billing overview), and invited-but-unactivated members are
never counted. There is a *second, independent* staff number —
`checkout/route.ts`'s `orgStaffNum` from `facilities[0].staffCount`, a manual
onboarding figure. Do not conflate them.

**Why:** these look like obvious bugs to a future reader and will be "helpfully"
fixed unless the deliberate deferral is recorded.

**How to apply:** if asked to touch billing checkout/pause/seat counting, confirm
scope with the user before changing any of the above.

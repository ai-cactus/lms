---
name: billing-schedule-deferred-scope
description: What is left of the deliberate non-fixes from the 2026-08-25 cancel/resume/seats work — pause keeps its hard 409 on a pending schedule; everything else has since closed
metadata:
  type: project
---

The `bugfix/billing-cancel-resume-seats` work (2026-08-25) deliberately left
some billing behaviour alone. Status as of 2026-09-21:

- **Closed since:** `checkout`'s missing pause check (the route now 409s on
  `pausedAt || pauseStartsAt`, `src/app/api/billing/subscription/checkout/route.ts`),
  **#27 plan-change proration** and **#28 deferred pause start** — all implemented
  2026-08-27, see [[billing-2026-08-27-decisions]].
- **Still deliberate:** `pause/route.ts` keeps its hard 409 on a pending
  `stripeScheduleId` while cancel/resume/reactivate auto-release it. This
  asymmetry is a product decision, not an inconsistency to "clean up".

**Seat counting — settled.** BUG-07 / Q-11 were ruled on 2026-09-23 (the owner
DOES consume a seat) and every surface now shares one helper. See
[[gotcha-seat-counting-is-owner-inclusive]].

**Why:** these look like obvious bugs to a future reader and will be
"helpfully" fixed unless the deliberate deferral is recorded.

**How to apply:** if asked to touch billing pause or seat counting, confirm
scope with the user before changing any of the above.

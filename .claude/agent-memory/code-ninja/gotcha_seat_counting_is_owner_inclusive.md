---
name: gotcha-seat-counting-is-owner-inclusive
description: BUG-07/Q-11 ruled 2026-09-23 — the owner DOES consume a plan seat; countBillableSeats/countBillableStaff in src/lib/seat-limits.ts are the only definition, and four surfaces used to hand-roll it
metadata:
  type: project
---

Founder ruling (2026-09-23, BUG-07 / Q-11): **the owner consumes a plan seat** —
they use the learning features like anyone else. No role is exempt, and neither
the member count nor the pending-invite count filters on one.

**Why:** the billing page counted the owner while `countBillableStaff` excluded
them, so a customer could see "5 of 5" while the gate still had room (or be at
6 of 5 and blocked). One definition, two answers.

**How to apply:** every seat figure — gauge or gate — goes through
`countBillableSeats` (split: `activeMembers` / `pendingInvites`) or
`countBillableStaff` (the sum) in `src/lib/seat-limits.ts`. Four surfaces had
hand-rolled copies before this landed: `api/billing/overview/route.ts`,
`dashboard/(main)/staff/page.tsx`, `dashboard/(main)/settings/page.tsx` and the
helper itself. The settings copy had also lost `active: true`, the same defect
the roster hit in staging QA 2026-09-04 — removed staff kept consuming seats.
Two `organizationUser.count` call sites are deliberately NOT seat counts and
must stay as they are: `course.ts` `totalOrgStaff` (a WORKER_ROLES,
facility-scoped training-coverage denominator) and `dashboard-facility.ts` /
`auditor.ts` (compliance tallies).

**The live consequence to state whenever this changes:** every org gains one
seat of usage the moment it ships. Nothing revokes access — the gates only block
*adding* (`createInvites` returns a `limitError`, `/api/invite/accept` 409s via
`SeatLimitError`, `enrollUsers` seat-rejects new emails, checkout 422s). But an
org sitting exactly AT its cap now reads cap+1, so `canSelectPlan` greys out its
own current plan card in `SubscriptionTab` and the checkout route refuses it.
No grace policy exists and none was invented — see [[project_billing_schedule_deferred_scope]].

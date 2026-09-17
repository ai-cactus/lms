---
name: billing-state-redirect-is-not-rbac
description: Three pages carry BOTH an RBAC gate and a billing-state gate; Q26's 404 applies only to the RBAC branch, and e2e pins the billing redirects
metadata:
  type: project
---

`courses/create`, `training/courses/[id]/assign` and `billing/cancel` each run
two refusals in sequence. Only the first is an RBAC denial.

- RBAC (`course.create` / `assignment.create` / `billing.edit`) → `notFound()`.
- Billing state (no active subscription, paused, nothing left to cancel) →
  still `redirect()` to `/dashboard/courses` or `/dashboard/billing`.

**Why:** founder Q26 governs *"a role lacks access to a module"*. A paused
subscription is a fact about the organisation, not a statement about the role —
and the target of the redirect is where the gate UI explains itself, so a 404
would be strictly worse for the user. `billing-plan-change-and-gating.spec.ts`
pins both redirects end-to-end (the assign one at the `00000000-…` course id,
which works because the billing gate runs before the course lookup).

**How to apply:** when touching any of these three, say explicitly which branch
you are changing. A blanket "make denials 404" sweep across the file reddens
that spec and degrades the UX of a legitimate customer state. Same split in the
unit tests: each of the three now has a paired `it(... still REDIRECTS ...)`
case guarding the billing branch against exactly that.

See [[q26-deny-shape-traps]].

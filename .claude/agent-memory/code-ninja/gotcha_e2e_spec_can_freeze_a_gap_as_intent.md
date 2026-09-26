---
name: gotcha-e2e-spec-can-freeze-a-gap-as-intent
description: tests/e2e/rbac-role-change.spec.ts asserted "no in-place role UI exists" — that was a deleted-dead-code GAP, not a ruling; grep e2e for ABSENCE assertions before building any missing affordance (and UNIT tests freeze defects the same way — BUG-01)
metadata:
  type: project
---

Before building an affordance the product is missing, **grep `tests/e2e/` for
specs asserting it is ABSENT** — not just for specs that drive it. A spec written
right after a redesign can freeze an accidental gap as though it were a decision,
and it will redden your PR with a premise that reads authoritative.

**Why:** `tests/e2e/rbac-role-change.spec.ts` opened with "the UI path was
REMOVED" and asserted `getByRole('button', { name: 'Edit Profile' })` had count 0
for owner/supervisor/hr. Nothing had been decided: the staff-profile header was
reworked to the Figma design, `EditStaffModal` was left with zero usages and
deleted as dead code, and the spec documented the result. Live QA later found
`updateStaffDetails` correctly authorized and **invoked by nothing** — founder
rulings Q2 and Q11 had shipped as permissions against an unreachable action. The
spec was guarding the defect.

**How to apply:**
- A `toHaveCount(0)` on a control is only as good as its header comment's
  premise. Read the premise, then ask whether it cites a *ruling* or merely
  describes what the code happened to do after a refactor.
- The repo's convention for this is to **rewrite the spec in the same PR** with a
  dated `SUPERSEDED PREMISE, REWRITTEN <date>` block naming what changed and why
  — `rbac-staff-view-only.spec.ts` and `staff-assign-courses.spec.ts` ("FLIPPED
  2026-09-16") both carry one. Keep every assertion still true; invert only the
  ones the ruling reverses. Never delete the spec.
- The staff profile is covered by **13** e2e specs (`grep -ln "dashboard/staff"
  tests/e2e/*.spec.ts`). Run all of them, not just the two that look related —
  `rbac-role-change.spec.ts` was the only one that broke and its name does not
  mention the profile page. CI skips e2e on feature PRs, so nothing else catches it.

**Unit tests do it too, and they are harder to spot** because they read as
specifications rather than observations. BUG-01 (Finance's dashboard tiles
disagreeing with Owner's) was asserted as intent in TWO committed tests —
`org-scope.test.ts` "keeps an admin-tier role WITHOUT course.read (finance)
scoped to its own authored courses" and `course.test.ts` "a non-manager
(finance — no course.read) stays creator-scoped". Both were written when the
*course list* was being scoped and were then inherited, unexamined, by the
aggregate population. When a fix goes red on a test whose name states the bug,
rewrite it with a dated `SUPERSEDED <date>` block — do not soften the fix.

Related: [[gotcha_rbac_actor_lists_vs_permissions]],
[[gotcha_q26_deny_shape_traps]] (vacuous absence assertions),
[[gotcha_dashboard_two_actions_one_population]].

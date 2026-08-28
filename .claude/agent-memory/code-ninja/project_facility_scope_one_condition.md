---
name: facility-scope-one-condition
description: The user's 2026-08-27 ruling that every facility view/switch/reassign gate collapses to "can this viewer see more than one facility?" — and that ORG_WIDE_FACILITY_ROLES must not change
metadata:
  type: project
---

Final product rule (user, 2026-08-27): every role with global or multi-facility
access may filter/switch to a specific facility view; a role scoped to a single
facility sees only that facility and can never reach org-wide data or switch.
A single-facility ORG gets the single-facility dashboard; a multi-facility org
gets the global consolidated view.

**Why:** it collapses to ONE condition — the count of the viewer's *accessible*
facilities (`listAccessibleFacilities`, already narrowed for facility-bound
roles). Org-wide role + 1-facility org → single. Supervisor with 2 facilities →
consolidated across just those two. There is no separate "is this a manager?"
test.

**How to apply:**
- Do NOT edit `ORG_WIDE_FACILITY_ROLES` (src/lib/facility/scope.ts) — owner,
  admin, hr, clinical_director, finance, with supervisor deliberately absent.
  It is already correct; supervisor's power is scope, not verbs.
- The dashboard global-vs-single branch is `globalData.facilities.length > 1`.
- `FacilityScopeSwitcher` self-guards (returns null under 2 accessible
  facilities) so call sites cannot forget it. Don't re-add a call-site guard.
- The STAFF "Change Facility" action is a DIFFERENT feature from the view
  switcher (it reassigns a member), but under this rule it takes the same
  `facilities.length > 1` test, on top of its existing `user.edit` check.

See [[org_facility_split]], [[supervisor_own_facility_edit]],
[[rbac_role_model]].

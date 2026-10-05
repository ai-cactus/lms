---
name: gotcha-owner-writes-take-the-org-lock
description: Any write that can demote/deactivate an OrganizationUser must lockOrganizations() then wouldLeaveOrganizationOwnerless() in one transaction (RISK-16)
metadata:
  type: project
---

`src/lib/organization/owner-guard.ts` owns the "every org keeps an active owner"
invariant. A new write path that changes `OrganizationUser.role` or `active`
must, inside ONE interactive transaction: `lockOrganizations(tx, [orgId])`
(SELECT ... FOR UPDATE on `organizations`, id-ordered), re-read the membership,
then `wouldLeaveOrganizationOwnerless(tx, row)`; refuse by RETURN in Server
Actions (`LAST_OWNER_REFUSAL`), throw `LastOwnerError` from lib code.

**Why:** `softDeleteUser` (Q-30) had the lock but nothing else did, so a delete
and a demotion of the other owner could both pass. Owner is in no
GRANTABLE_ROLES list, so `updateStaffDetails`/`removeStaff` can't demote an owner
anyway; the one REAL demotion path is `createMembership`'s upsert (`update:
{ role }`) — `joinOrganization` has no active-member guard, so an owner typing
their own org's join code gets re-roled to the default worker role.

**How to apply:** `staff.test.ts`'s `txClient` shares the top-level delegates
(`mockOrgUserFindUnique` etc.) plus `mockQueryRaw`; a role change re-reads via
the SAME findUnique mock, so `mockResolvedValueOnce` chains need a 2nd value.
The end-to-end race harness (blocking fake FOR UPDATE + slow writes + a no-lock
control) lives in `owner-guard.test.ts` — reuse it for new owner paths.

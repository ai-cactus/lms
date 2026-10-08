---
name: gotcha-global-invite-anchor-ouf-row
description: A Global (org-wide role) invite is anchored to the oldest facility and acceptance writes a real OrganizationUserFacility row there
metadata:
  type: project
---

Global invites (`createInvites` with `facilityId: null`) store the org's OLDEST facility in the required `Invite.facilityId`, and `createMembership` (invite accept, `src/app/api/invite/accept/route.ts`) turns that into an active `OrganizationUserFacility` row. BUG-68 ruling (2026-10-08): display-only fix — the staff list Facility column and the profile header show "All facilities" for any `isOrgWideFacilityRole` holder; acceptance and `createMembership` stay as they are. The STAFF_ADDED notice still carries the anchor facility.

**Why:** the anchor is inert for org-wide roles (data scope comes from the role), but any display that reads roster rows will name an arbitrary facility.

**How to apply:** any new surface listing a member's facilities must special-case org-wide roles too; don't treat an org-wide member's facility rows as meaningful; since 2026-10-08 `checkInviteRolePath` (`src/lib/facility/invite-role-path.ts`) guarantees only org-wide roles reach the anchor. See [[project-facility-scope-one-condition]].

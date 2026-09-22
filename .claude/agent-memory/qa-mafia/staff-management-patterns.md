---
name: staff-management-patterns
description: Staff Management (/dashboard/staff) patterns still valid after the 2026-07 findings were overtaken. Real roles exist (12 grantable), CSV import exists in the Add Staff dialog, pending rows offer only Revoke Invite
metadata:
  type: reference
---

**Location:** `/dashboard/staff` (sidebar "Staff Management"). The "Add Staff" button opens `InviteStaffModal`. That modal supports both chip-based email entry and a CSV upload path. CSV rows pre-fill roles, and skipped rows are surfaced (see [[staff-csv-import-and-removal-gaps]]).

**Roles are real.** Every staff member holds a role from `src/lib/rbac/permissions.ts` (owner/admin/supervisor/hr/clinical_director/finance plus 8 worker roles). "Job Title" is a separate free-text field; don't confuse the two. For who can grant what, see [[rbac-role-grant-matrix]].

**Row actions differ by status.** A **pending** invite's row actions offer only "Revoke Invite" (`RevokeInviteModal`), behind a confirmation dialog. An **active** staff member's row opens `/dashboard/staff/<uuid>`:
- Role changes go through `ChangeRoleModal`.
- Name and job title go through `EditProfileModal`. Its "Save Changes" opens a SECOND "Confirm Changes" dialog. Missing that click looks exactly like a silent persistence bug.
- Facility changes go through `ChangeFacilityModal`, which is single-select.
- "Remove Staff" is in the kebab.

**Removal retains training records.** `removeStaff()` keeps all enrollments and certificates, including in-flight ones (founder Q23, `243375f4`). A re-invite of the same email restores them.

**Onboarding caution:** an org's "Complete Onboarding" flow resubmits the whole onboarding bundle. Don't drive it on an already-onboarded fixture org, because it can overwrite that org's real configuration.

---
name: rbac-matrix-realignment-role-change
description: RBAC matrix realignment (Change 1) + in-place role change (Change 2) test suite — HR missing user.delete product bug, canChangeRole/updateStaffDetails unit patterns, role-change e2e flow
metadata:
  type: project
---

Tested the RBAC matrix realignment (Finance/Clinical Director → view-only on
staff; HR/Owner/Supervisor keep full staff CRUD) and in-place role change
(`canChangeRole` in `src/lib/rbac/role-utils.ts`, wired into
`updateStaffDetails` in `src/app/actions/staff.ts`) on branch `rbac`.

**Confirmed product bug (reported, not fixed by me):** `hr`'s permission
entry in `src/lib/rbac/permissions.ts` (~line 202-229) never includes
`user.delete` — only `user.create/read/edit` plus invite/enrollment/etc.
Before this change, `removeStaff`/the UI used the coarse `isAdminRole()`
check so HR could always remove staff; the realignment switched the gate to
`can(role, 'user.delete')`, which silently strips HR's staff-removal
capability — contradicting the plan's explicit "HR keeps full staff CRUD"
decision. Reproduces identically in:
- unit: `staff.test.ts` → `removeStaff() — permission matrix (user.delete gate) > allows hr to remove a staff member`
- e2e: `rbac-staff-view-only.spec.ts` → `hr: retains full staff CRUD affordances` (Remove Staff menuitem/button not found)
Fix is presumably adding `'user.delete'` to hr's permissions array — not done here per bug-hunter scope (test/report only).

**Test files added:**
- `src/lib/rbac/role-utils.test.ts` — `canChangeRole` describe block (all 4 deny reasons in order, allow paths, `ROLE_CHANGE_ACTOR_ROLES` shape).
- `src/app/actions/staff.test.ts` — extended with: `updateStaffDetails` permission-matrix (user.edit) + role-change (canChangeRole integration: bump/audit vs no-op, hr/self/supervisor→owner denials); `setStaffManager` permission-matrix; `assignCourseToStaffMember` (new action) permission gate/org-scope/delegates-to-enrollUsers; `revokeInvite` permission-matrix (previously untested); `resendInvite` permission-matrix; `removeStaff` permission-matrix. Added `mockInviteDelete` and `mockEnrollUsers` (`vi.mock('@/app/actions/enrollment', ...)`) to the existing hoisted-mock setup.
- `tests/e2e/rbac-staff-view-only.spec.ts` (new) — finance/clinical_director view-only (list row kebab absent for pending invites, Remove Staff absent for active staff, profile buttons/manager-select gated), hr regression, owner control group.
- `tests/e2e/rbac-role-change.spec.ts` (new) — owner HR→Nurse role change kills live session (next nav → /login) + re-login lands on /worker + enrollment/certificate history preserved; worker→admin promotion lands on /dashboard; HR sees read-only role field; supervisor can't select Owner (option absent); self role-change blocked (read-only + caption).

**Gotchas hit while writing these:**
- Two full false-failure detours (see [[hmr-interference-during-e2e-runs]]) — don't repeat that debugging path; the real bug is narrow (see above), everything else in the matrix works.
- `EditStaffModal`'s post-save "Staff details updated successfully" text is only visible for ~1s before the modal auto-closes (`setTimeout(...1000)` in the component) — asserting on that transient text directly is racy under dev-server compile latency. Assert `dialog` becomes hidden instead (generous timeout), not the intermediate text.
- `authenticate()` (src/app/actions/auth.ts) looks up the role fresh from the DB on every login attempt and routes accordingly — plain `/login` (no `?worker=true`) correctly routes a freshly-demoted-to-worker or freshly-promoted-to-admin account to the right portal; no need for the `?worker=true` query param in role-change e2e re-login assertions.
- `getStaffUsers()` excludes `role: 'owner'` from the staff list, but an owner CAN still view/edit their own profile via direct `/dashboard/staff/{id}` navigation (`getStaffDetails` has no self-exclusion) — used this for the self-role-change-blocked e2e test.
- `EditStaffModal`'s Role `<Field>` wraps its content in a `<>` Fragment in both the editable and read-only branches, so `Field`'s `cloneElement`-based `htmlFor`/id wiring doesn't reach the actual Select/Input (same class of issue as [[onboarding-invite-settings-phase-tests]]'s Radix Select id-clone note) — don't use `getByLabel('Role')`; scope via `dialog.getByRole('combobox')` (present only when editable) or assert the read-only caption text instead.

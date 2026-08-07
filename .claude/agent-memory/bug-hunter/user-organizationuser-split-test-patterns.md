---
name: user-organizationuser-split-test-patterns
description: Test patterns for the User→OrganizationUser schema split on branch multi-facility (2026-08-03) — 10 test files ported, membership-mocking convention, key intended behavior changes
metadata:
  type: project
---

On 2026-08-03, branch `multi-facility` landed a schema refactor splitting `User`
(global identity: email, password, firstName/lastName/fullName/avatarUrl — Profile
table deleted and merged in) from `OrganizationUser` (per-org membership: role,
active, managerId, joinedAt, roleAssignedAt, lastLoginAt) plus
`OrganizationUserFacility`. All domain FKs (`Course.createdByOrgUserId`,
`Document.organizationUserId`, `Enrollment.organizationUserId`,
`Certificate.organizationUserId`, `Notification.organizationUserId`,
`NotificationPreference.organizationUserId`) point at `OrganizationUser.id`, not
`User.id`. Full plan: `docs/multi-org-schema-upgrade-plan.md`.

Ported 10 test files to green (173 tests): the three quiz API routes
(save/start/submit), the video route, `create-auth-instance.test.ts`,
`enrollment/create.test.ts`, `enrollment/invite-courses.test.ts`,
`notifications/emit.test.ts`, `reminders/status-tracker.test.ts`,
`reminders/sweep.test.ts`.

**Session/JWT shape**: `session.user` now carries `id` (User.id),
`organizationUserId`, `organizationId`, `role` — all three resolved from the SAME
`OrganizationUser` row by `src/lib/auth/membership.ts` helpers
(`resolveActiveMembership`, `getActiveMembership`, `createMembership`,
`recordMembershipLogin`). `create-auth-instance.ts` mocks `@/lib/auth/membership`
directly rather than reconstructing prisma organizationUser chains — much
simpler, and membership.ts has its own passing suite
(`src/lib/auth/membership.test.ts`) to lean on.

**`resolveActiveMembership` returns a discriminated union** — `{kind:'none'}`
(never joined, → onboarding, provisional role), `{kind:'revoked'}` (memberships
exist but all deactivated, → deny login), `{kind:'resolved', membership}`,
`{kind:'choice', memberships}`. Tests must pick the right kind per scenario — a
"removed staff member" test must use `revoked`, not `none`, or the ISSUE-2 guard
never fires.

**Nested `organizationUser.facilities` array replaces a flat `facility` field.**
Anywhere the old model had `user.facility: {timezone} | null`, the new select is
`organizationUser: { facilities: { where: {active:true}, take:1, select:
{facility:{select:{timezone}}} } } }` — an ARRAY (usually one active row), not a
nullable object. "No facility" is now `facilities: []`, not `facility: null`.
Applies to `reminders/status-tracker.ts` and `reminders/sweep.ts` (Track A only —
Track B's select has no facilities at all).

**Intended behavior change — cross-tenant lookup no longer special-cased.**
`src/lib/enrollment/create.ts`: an email that resolves to a `User` with no ACTIVE
`OrganizationUser` membership in the CALLER's org (including a member of a
DIFFERENT org entirely) now goes through the SAME invite-branch path as an
unknown email — it is NOT rejected as `'failed'` anymore (per the source comment
"Tenancy is now structural"). Only a null `ctx.organizationId` (no org context at
all) produces `'failed'`, and in that case the membership lookup never even
fires (`user && ctx.organizationId ? await prisma.organizationUser.findFirst(...) :
null`). A test asserting the old "cross-tenant → failed" behavior encodes stale
logic and must flip to asserting `'invited'`.

**Intended behavior change — admin role no longer force-killed.** Per
`multi-org-schema-upgrade-plan.md` Decisions §8, `admin` re-enters `UserRole` as a
normal Owner-equivalent role; the old JWT-re-validation guard that force-invalidated
legacy-`admin` sessions is gone from `create-auth-instance.ts`. The pre-refactor
version of `create-auth-instance.test.ts` (as found on this branch) had NO test
literally asserting that old kill-switch — added new regression tests instead
(`authorize()` allows `role:'admin'` through the admin gate; `jwt()` keeps a
session with fresh DB role `admin`) to pin the flip explicitly, since the task
called it out as notable.

**Auto-enroll hooks now take `organizationUserId`, not `userId`.** In the OAuth
signIn callback (`create-auth-instance.ts`), `enrollUserForRoleTargets` and
`enrollInviteCourses` are called with
`invitedMembership.organizationUserId`/`activeMembershipOf(resolution).organizationUserId`
as the first arg — was the identity's `userId` pre-refactor.

**`Invite.facilityId` is now required** (every invite targets a facility).
`enrollment/create.ts`'s invite branch falls back to `prisma.facility.findFirst`
when `ctx.facilityId` is null, and fails cleanly if the org has zero facilities —
new test case worth keeping: "reports failed when the organization has no
facility to attach the invite to."

**`enrollInviteCourses(organizationUserId, inviteId)`** resolves the membership
via `prisma.organizationUser.findFirst({where:{id, organizationId:
invite.organizationId, active:true}, select:{user:{email}, organization:{name}}})`
instead of `prisma.user.findUnique` — the cross-tenant guard is now enforced
structurally by the `organizationId` filter in that single query, not a
post-hoc comparison.

**Notification recipients renamed `userIds`→`organizationUserIds`.**
`src/lib/notifications/recipients.ts`'s `resolveRoleRecipients` and
`src/lib/reminders/recipients.ts`'s `resolveEscalationRecipients` both return
`{organizationUserIds, emails}` (emails carry both `organizationUserId` and the
underlying `userId`). `createNotification` calls take `organizationUserId` field,
not `userId`. Any test's hand-rolled recipients() fixture helper must follow suit.

Related: [[project-test-framework]], [[org-facility-split-test-patterns]],
[[reminders-test-patterns]], [[quiz-attempt-route-tests]],
[[notification-engine-test-patterns]].

## Second batch (same day, 2026-08-03): `src/app/actions/*` layer

Ported a second batch of 10 files to green (232 tests): `create-org.test.ts`,
`documents.test.ts`, `facility.test.ts`, `notification-settings.test.ts`,
`offering.test.ts`, `onboarding-complete.test.ts`, `organization.test.ts`,
`staff.test.ts`, `user.test.ts`, `video-progress.test.ts`. These are the
higher-level server actions built on top of the membership layer above, plus
the RBAC permission-registry ruling that landed in the SAME refactor
(`src/lib/rbac/permissions.ts` — 427/427 passing, treated as ground truth, not
touched).

**`createMembership()` mocking convention.** Any action that links a founder to
a new org (`organization.ts#createOrganization`, `onboarding-complete.ts`)
calls `createMembership({userId, organizationId, facilityId, role})` from
`@/lib/auth/membership` instead of writing `role`/`organizationId`/`facilityId`
directly onto `User`. Mock the whole module (`vi.mock('@/lib/auth/membership',
() => ({ createMembership: mockCreateMembership }))`) rather than trying to
reconstruct its internal `organizationUser.upsert` + `organizationUserFacility.upsert`
transaction — same lesson as the first batch's `create-auth-instance.ts` note.
The one-org-per-user guard in both actions also moved from
`prisma.user.findUnique({organizationId})` to
`prisma.organizationUser.findFirst({where:{userId,active:true}})`.

**Some actions read role/org straight off the session — no DB round-trip.**
`offering.ts`'s `resolveOrg(session.user)` and `staff.ts`'s `revokeInvite`/
`resendInvite` read `organizationId`/`role` directly from the JWT session
object, not via a `prisma.user.findUnique` lookup. A pre-refactor test fixture
that mocks `user.findUnique` to supply role/org for these functions is stale
dead code — the mock is simply never called; the FIX is to put
`organizationId`/`role` directly into the `mockAuth`/`mockAdminAuth` session
fixture instead. This tripped up `offering.test.ts` non-obviously: the test
file's `mockUserFindUnique` looked plausible but `offering.ts` never imports
`prisma.user` at all.

**RBAC ruling cascades hard into every staff/org write path — supervisor lost
almost everything.** `supervisor`'s permissions became `readEverythingExceptBilling
+ selfServicePermissions` (read-only, no billing) — it now FAILS `user.edit`,
`user.delete`, `invite.edit`, `invite.delete`, `facility.edit`, and
`organization.edit`, all of which it held before the ruling. Every one of
those permission checks in `staff.ts`/`organization.ts` needed its supervisor
fixture flipped from "allowed" to "denied". `organization.edit` now resolves to
Owner/Admin ONLY (not supervisor/hr/clinical_director/finance, who only ever
had `organization.read`). Meanwhile `hr` gained FULL document CRUD
(`document.create/read/edit/delete`, not just read) — inverting the opposite
direction from a pre-ruling "HR is read-only on documents" assumption baked
into `documents.test.ts`. When porting ANY RBAC-gated action test on this
branch, don't assume the old allow/deny matrix still holds — check
`src/lib/rbac/permissions.ts`'s actual `roles.<role>.permissions` array first.

**`ROLE_CHANGE_ACTOR_ROLES` is `['owner', 'admin']` — supervisor can no longer
re-role ANYONE.** `staff.ts#updateStaffDetails`'s role-change path
(`canChangeRole`) used to accept supervisor as an actor pre-ruling; now
supervisor is blocked even earlier, at the coarse `user.edit` gate, before
`canChangeRole` is ever reached. Tests that exercised supervisor-specific
`canChangeRole` outcomes (`role_not_grantable`, successful re-role) are now
testing an unreachable path and must be removed/replaced — use `admin` (the
new Owner-equivalent role) to keep meaningful `ROLE_CHANGE_ACTOR_ROLES`
coverage instead.

**Suspected stale copy bug (not fixed — flagged only):**
`staff.ts` `ROLE_CHANGE_DENIED_MESSAGES.actor_not_permitted` still reads
`"Only an Owner or Supervisor can change a staff member's role."`, but
`ROLE_CHANGE_ACTOR_ROLES` is `['owner', 'admin']` — supervisor is DENIED by
this exact message while being named in it as an allowed actor. Functionally
correct (denies supervisor), just misleading copy; should probably say "Owner
or Admin". Left as-is per instructions (test asserts the actual returned
string).

Related: [[project-rbac-proxy-bug]], [[rbac-matrix-realignment-role-change]],
[[documents-hub-rbac-gate-tests]].

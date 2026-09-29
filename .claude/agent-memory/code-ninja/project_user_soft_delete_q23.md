---
name: project-user-soft-delete-q23
description: Deleting a user is a SOFT delete (Q-23, 2026-09-28) — deletedAt + every membership deactivated; the sign-in guards that make it work and the traps
metadata:
  type: project
---

Deleting a user never removes rows. `softDeleteUser` (`src/lib/system/delete-user.ts`) is the ONLY
delete path — the /system console and `scripts/delete-user.ts` / `delete-workers.ts` all call it
(RISK-14). It stamps `User.deletedAt`, bumps `sessionVersion`, deactivates EVERY membership (the
same per-org state `removeStaff` leaves), expires pending invites only from the person's own orgs
(BUG-26), revokes verification tokens, and audits `system.user.delete {mode:'soft'}`. Custody
transfer (BUG-09's `findAssetCustodian`) was deleted with it: authorship is kept (BUG-49).

**Why:** founder ruling Q-23 — certificates/enrolments/attempts must survive the person's removal.

**How to apply:**
- A deleted identity's email is NOT freed (`User.email` is unique and the row stays). Signup
  already says "account exists"; OAuth must redirect `AccessRevoked` BEFORE the create branch.
- There is NO Prisma extension filtering `User` reads — a filtered "does this email exist" lookup
  would send every create path into a P2002. Instead each pre-session entry point selects
  `deletedAt` and calls `isDeletedIdentity` (`src/lib/auth/deleted-identity.ts`); JWT revalidation
  treats a deleted row as absent; `createMembership` throws `DeletedIdentityError` as the backstop.
  A NEW auth/sign-up/invite path must add the same check.
- Lists/counts need nothing new: they already filter `OrganizationUser.active`. A query that lists
  "members" WITHOUT `active` will show deleted people (the settings team list had exactly that bug).
- Audit reads (auditor roster/export) deliberately include inactive members — that is what keeps a
  deleted person's records auditable. Do not add `active: true` there.
- Q-30 (2026-09-29): the delete REFUSES (changes nothing) if an org would be left with no active
  owner or no active member; checked inside the tx after `SELECT … FOR UPDATE` on the orgs.
- Q-31 (2026-09-29): inviting/assigning a deleted email is refused with the generic
  `DELETED_EMAIL_REFUSAL` (`src/lib/auth/deleted-email-guard.ts`) — createInvites, resendInvite,
  onboarding invites, and `createEnrollmentForUser` (reported as a plain `failed`). A NEW invite
  path must call the same guard.
Related: [[project_archive_filter_and_raw_prisma]], [[gotcha_revalidation_cache_is_identity_only]].

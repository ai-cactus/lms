---
name: org-soft-delete-pr-a-tests
description: PR A (org soft delete/restore, /system Organizations) test techniques and traps — strict in-memory fake with tx rollback, e2e join-code step is unreachable, monitor tools are unreliable for long e2e runs
metadata:
  type: project
---

Tests for `feature/system-org-soft-delete` (uncommitted when written, 2026-10-08).
164 files / 3200 tests green in the prescribed vitest slice; new e2e spec
`tests/e2e/system-organization-soft-delete.spec.ts` green; 10 neighbouring specs green.

**Technique that paid off:** `src/lib/system/delete-organization.test.ts` uses a
strict Proxy fake (unknown model/method/where-key throws) whose `$transaction`
snapshots with `structuredClone` and restores on throw. That proves "delete +
audit commit together" and the delete→restore membership round trip against
state, not call mocks. Copy it for the later user/org hard-delete PRs.

**Why:** the restore contract is `OrganizationUser.deactivatedAt == Organization.deletedAt`
to the millisecond, so tests compare `getTime()`, never object identity.

**e2e traps:**
- The join-code UI (`/onboarding-worker`) cannot be driven: it needs an org-less
  WORKER session, and no credentials login produces one (`authenticate()` sends
  membership-less identities to the admin portal; `authenticateWorker` has no
  UI caller). Join-code deletion is unit-covered only. Logging an org-less
  identity in and visiting it triggers the SessionIdentityGuard "signed out
  because another account signed in" alert.
- A worker in a seeded org with no `subscriptions` row is billing-blocked
  (`[WorkerLayout] Portal blocked`) but still lands on `/worker`, so assert the URL.
- `SYSTEM_ADMIN_PASSWORD=e2e-system-admin` must be exported for any `/system/**` spec.
- Tool trap: `Monitor` tick/sleep tasks fire early and flood the context with
  notifications. For long runs use a foreground `until grep -q MARKER file; do sleep 5; done`
  Bash loop (timeout up to 600000) over a nohup'd chain script instead.
- `E2E_SKIP_BUILD=1` is safe for a chain of specs when product code is unchanged
  between them; only the first run needs the ~5 min build.

**Existing-test adjustments that recur whenever `createMembership` or the
membership choke point changes:** tx mocks need `$queryRaw` + `organization.findUnique`;
`listActive/getActiveMembership` `where` assertions need `organization: { deletedAt: null }`;
sweep.test needs `prisma.organization.findMany` defaulting to `[]`.

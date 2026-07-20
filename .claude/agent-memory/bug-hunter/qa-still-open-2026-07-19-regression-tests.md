---
name: qa-still-open-2026-07-19-regression-tests
description: Test patterns for the billing RBAC / documents RBAC / worker-billing-gate / re-invite lifecycle fix batch (branch bugfix/qa-still-open-2026-07-19) — the worker-billing-gate seed-fixture trap that broke 3 unrelated pre-existing specs
metadata:
  type: project
---

Context: this batch replaced `isAdminRole` with registry `authorize()`/`can()` on 12 billing
routes + 4 document actions, added a worker-portal billing gate (`WorkerLayout` renders
`WorkerBillingBlockedScreen` when `hasActiveBilling()` is false — missing subscription row
counts as inactive) plus defense-in-depth on quiz start/submit, and added the org-less
re-invite relink (`createInvites`/accept route). Full details: `.claude/plans/toasty-wandering-feigenbaum.md`.

**The most important finding this session**: the new worker-portal billing gate is
retroactive risk for EVERY existing e2e spec that seeds its own fresh org via raw `pg` and
puts a WORKER-role user in it, because none of those pre-existing specs ever needed a
`subscriptions` row before — `hasActiveBilling()` now treats "no row" as inactive, so any such
spec's worker-portal visit (even just `/worker` or `/worker/certificates`) now renders
`WorkerBillingBlockedScreen` instead of the real page. This broke **3 unrelated, pre-existing
specs** in the full e2e run: `rbac-role-change.spec.ts` (2 tests — re-login landing on
`/worker`/`/dashboard` after a role change, and the "history preserved" `/worker/certificates`
check) and `rbac-dual-cookie-login.spec.ts` (1 test — the bridged-Learn-mode logout test,
which clicks `header().getByText('Dual Cookie')`, the WORKER dashboard's own profile-name
header element that never renders behind the blocked screen). Fix applied: add an active
`INSERT INTO subscriptions (...)` row (copy the exact column list from
`tests/e2e/worker-billing-gate.spec.ts`'s `seedWorker()`) to each spec's own org-seeding
helper, and a matching `DELETE FROM subscriptions WHERE organization_id = $1` in its cleanup.
**Any future e2e spec that raw-seeds an org with a worker-role user must include this insert
from now on**, not just billing-focused specs — this is the durable takeaway, not just a
one-off fix. See [[billing-phase4-defect-tests]] for the original `subscriptions` table
insert pattern this was modeled on.

**Fixture-pollution across e2e suite runs (re-confirmed, distinct instance)**: running the
full 108-test suite WITHOUT reseeding first produced 11 failures — `course.spec.ts` ENG-022
(strict-mode violation: worker `worker@test.com` had accumulated a SECOND enrollment in the
same course from an earlier unseeded run, so a name-based row locator matched 2 rows),
`quiz-retake-attestation.spec.ts` (stale quiz-attempt/lockout state), and all 3 `reminders.spec.ts`
`#assign-input` timeouts. Reseeding (`DATABASE_URL=...lms_e2e npx prisma db seed`) made every
one of these pass on the next run with NO code change — pure stateful-fixture pollution, not
a regression. This reconfirms the existing runbook note ("seed before EVERY suite run") but
worth restating: when a full-suite run shows failures in files you didn't touch and the
error is a strict-mode/element-count mismatch or a stale-state timeout, reseed and rerun
before assuming a regression.

**A genuine one-off flake, unrelated to this diff**: `quiz-retake-attestation.spec.ts`'s
"a nurse can pass the quiz and attest" test failed once with `locator.click: ... element was
detached from the DOM, retrying` on the "Start Quiz" button, then passed cleanly on every
other run (isolated-6-spec rerun, and the full-suite run before that). The seeded account
(`nina.nurse@test.com`) has an active, unpaused subscription — ruled out the billing gate.
Treat as a transient client-side re-render race (Fast Refresh or a state update mid-navigation
under the dev server), not a reproducible bug — no fix applied.

**Test-authoring gotcha this session**: `getByPlaceholder(/^password \(at least/)` (no `/i`
flag) against a real placeholder "Password (at least 12 characters)" (capital P) matches
ZERO elements — Playwright's `.fill()` on a locator with 0 matches doesn't throw immediately,
it retries under the action-timeout budget, which can silently eat the ENTIRE test timeout
with no specific stack frame pointing at the real cause ("Test timeout of Xms exceeded" with
no assertion detail). Always default regex-based `getByPlaceholder`/`getByText`/`getByRole`
locators to case-insensitive (`/i`) unless the case is a real behavioral assertion — a missing
flag here cost two full 120–180s timeout cycles to diagnose.

**New billing RBAC matrix pattern**: all 12 billing routes under `src/app/api/billing/` now
share ONE uniform RBAC shape regardless of which specific `billing.*` permission they check
(`read`/`edit`/`delete`/`create` all have the identical owner+finance-only grant in
`permissions.ts`) — supervisor/hr/clinical_director → 403 `{error:'Forbidden',
code:'INSUFFICIENT_PERMISSIONS'}` with zero Stripe/Prisma calls; owner/finance → 200. The 7
`subscription/*` routes additionally call `guardApiSession(session)` with NO `role` option
now (RBAC moved to `authorize()`; the guard only still enforces auth+MFA) — test that by
setting `mfaEnabled: true, mfaVerified: false` on the session and asserting 401
`MFA_REQUIRED` before any Prisma/Stripe call, on top of the per-role 403 matrix.

**Documents RBAC matrix (regression-relevant)**: `document.*` grants are NOT uniform like
billing — HR has `document.read` ONLY (no create/edit/delete, so HR is denied uploadDocument
too, not just delete/rename); Finance has NO `document.*` permission at all (not even read —
`getDocuments` returns `[]`); `clinical_director` has full CRUD. Don't assume "HR can upload
since it's a manager role" — check `permissions.ts`'s literal per-role array before writing
the test fixture.

**Fixture-pollution trap (vitest, distinct from the `mockResolvedValueOnce` one already in
[[billing-phase4-defect-tests]])**: `vi.clearAllMocks()` does NOT clear a `mockRejectedValue`
set on a mock in an EARLIER test in the same file — a later test reusing that same mock
function (e.g. `stripeMock.subscriptions.update`) silently inherits the rejection and gets an
unrelated 500 instead of the expected 200. Always explicitly `mockResolvedValue(...)` in any
new test added after an existing "Stripe throws" test that touches the same mock.

New test files added: 5 new billing route test files (`payment-methods/route.test.ts`,
`payment-methods/[id]/route.test.ts`, `payment-methods/[id]/default/route.test.ts`,
`portal/route.test.ts`, `contact-enterprise/route.test.ts`), `src/app/actions/user.test.ts`,
`src/app/worker/layout.test.tsx`, `src/components/dashboard/auditor/AuditorExportTab.test.tsx`,
`src/components/help/HelpCenterContent.test.tsx`, `src/lib/mfa.test.ts`; 3 new e2e specs
(`worker-billing-gate.spec.ts`, `staff-re-invite-lifecycle.spec.ts`, `help-center-search.spec.ts`).

Related: [[billing-phase4-defect-tests]], [[join-invite-critical-fix-regression]],
[[rbac-8-worker-role-split]], [[phase3-quiz-retake-attestation-tests]].

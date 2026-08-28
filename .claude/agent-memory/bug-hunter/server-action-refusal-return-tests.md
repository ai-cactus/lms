---
name: server-action-refusal-return-tests
description: fix/server-action-error-messages test-coverage gaps found and closed — billing-gate identity check, no component tests existed for AssignRetakeModal/AttestationModal
metadata:
  type: project
---

PR fix/server-action-error-messages (2026-08-28) converted several Server
Action refusals from `throw` to a returned value (Next.js redacts thrown
Server Action errors in production). The prior agent had already updated most
`src/app/actions/*.test.ts` files thoroughly (fail-closed assertions,
new-copy assertions), but left real gaps that bug-hunter closed:

1. `certificate.test.ts` only covered the score-fallback regression, not
   `issueCertificate`'s two return-based refusals (`ok:false` for
   not-completed / no-profile-name) or the idempotent already-issued
   `ok:true` path. All were untested despite the discriminated-result type
   being new in this PR.
2. `enrollment.assign-course-to-roles.test.ts` covered the invalid-deadline
   refusal but had NO billing-gate test, even though the shared internal
   `assignCourseToRoleTargets` (called by both `assignCourseToRole` and
   `assignCourseToRoles`) carries that gate. `assignCourseToRoles` wraps the
   delegate's result and always adds `targetRoles: [...]`, even on refusal —
   easy to miss when writing the expected object.
3. `staff.assign-courses.test.ts` asserted the billing-abort with a
   *hardcoded literal* matching `BILLING_GATE_ASSIGN_MESSAGE`'s current
   value — coincidental equality, not an identity check. Since `staff.ts`
   compares `outcome.refusedReason === BILLING_GATE_ASSIGN_MESSAGE`, the
   test should build its mock from the **imported real constant**
   (`@/lib/billing` is unmocked in that file) so a future drift between the
   constant and a hardcoded copy actually breaks the test. Added a companion
   "resembles but isn't identical" case to prove the loop does NOT abort on
   a similar-but-different string.
4. No component test files existed at all for `AssignRetakeModal.tsx` or
   `AttestationModal.tsx` — both were "callers wired" by this PR to surface
   the new returned refusal reasons, and neither had ever been tested.
   Created both from scratch (Radix Dialog renders fine in jsdom with no
   extra stubs needed — no Popover/Select/Calendar involved, unlike other
   modals in this repo that need a ResizeObserver stub).
5. `LearnClient.test.tsx` only tested the *thrown/rejected* retakeQuiz path
   (falls back to the fixed string). Added the *returned* refusal path
   (`{success:false, refusedReason}`) that the PR's redaction fix actually
   targets — the prior test would still pass even if the returned reason
   were silently swallowed.
6. Deliberately did NOT write a `CourseWizard.test.tsx` — no test file
   exists for the top-level wizard at all (869 lines, 9-step stateful flow,
   file upload / AI pipeline mocking required just to reach the publish
   step); only individual `Step*.test.tsx` files exist. The refusedReason
   banner it renders on a role-assignment refusal is real but lower-risk
   than the fail-closed/abort logic already covered, and out of scope for
   the "at minimum" callers the task specified (AssignRetakeModal,
   LearnClient). Flagged as a gap, not fixed.

Also confirmed the PR's `export interface AssignRetakeResult` /
`export type IssueCertificateResult` in 'use server' action files are
type-only exports (erased at compile time) — consistent with several
pre-existing type exports in the same files (`PrebuiltCourseRow`,
`EnrollUsersResult`, etc.) and NOT the "non-async export breaks next build"
trap; `tsc --noEmit` and the full vitest run both pass, and this class of
export is explicitly permitted by Next's 'use server' checker. No product
defect found in this PR.

See [Test Framework & Patterns](project-test-framework.md) for the general
Vitest conventions this project uses.

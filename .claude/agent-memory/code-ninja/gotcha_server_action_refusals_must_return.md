---
name: gotcha-server-action-refusals-must-return
description: User-facing refusals must be RETURNED from Server Actions, never thrown — production redacts thrown messages to React error #441
metadata:
  type: feedback
---

A refusal carrying guidance the user must act on has to be **returned** from a
Server Action, not thrown. Generic guards (`Unauthorized`, `Forbidden`,
`Course not found`, `Insufficient permissions`) and genuine internal errors stay
as throws.

**Why:** Next.js redacts errors thrown from Server Actions in production
builds — the client only ever receives React error #441 ("The specific message
is omitted in production builds"). Client code doing `setError(err.message)` is
correct and *still* shows an unintelligible internal string. This is not
theoretical: it made the retake feature look broken and prompted a product
decision to change a rule that was never wrong.

**How to apply:**
- Prefer adding an optional field to the action's EXISTING result type
  (`refusedReason?: string`, or `message`/`error` where the type already has
  one) so existing callers stay source-compatible. That is the established
  convention — see `enrollUsers` / `assignCourseToRoleTargets` in
  `src/app/actions/enrollment.ts`.
- Only when the success value has no room for a field (e.g. `issueCertificate`
  returns a Certificate row) use a discriminated result
  `{ ok: true, … } | { ok: false, reason: string }`.
- **The gate stays fail-closed.** Returning changes only how the refusal is
  *communicated*: no mutation may run, every authorization check stays as-is,
  and a caller that ignores the reason must still cause nothing to happen.
- Wire the caller too — a refusal that returns cleanly and displays nothing is
  no better than the redaction.
- A `'use server'` file may only export **async functions**; a shared message
  CONSTANT must live in a non-action module (this is why
  `BILLING_GATE_ASSIGN_MESSAGE` lives in `@/lib/billing`). Exported *types* are
  fine — they are erased. Getting the constant wrong fails `next build`, and
  neither `tsc` nor vitest catches it.
- An action already wrapped in try/catch that returns `{ success: false, error:
  message }` (e.g. `removeStaff`) is ALREADY safe — the message is captured
  server-side and never crosses the redaction boundary. Don't "fix" those.

Related: [[gotcha-server-action-redirectto-must-render]],
[[gotcha-quiz-route-error-body-shapes]].

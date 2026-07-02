---
name: qa-wave1-regression-patterns
description: Gotchas hit writing regression tests for the THER-001/010/002/013/003/007/015 QA bug-fix wave (billing, webhooks, course-ai-v4.6, PHI, invites, auth)
metadata:
  type: project
---

Regression suite added on branch `fix/qa-report-001` for a wave of QA-reported
bug fixes. Full file list: `src/app/actions/course-ai-v4.6.test.ts`,
`src/app/api/billing/subscription/checkout/route.test.ts`,
`src/app/api/webhooks/stripe/route.test.ts`, `src/app/actions/documents.test.ts`,
`src/app/actions/staff.test.ts`, `src/app/join/[token]/page.test.tsx`,
`src/lib/utils.test.ts`, `src/lib/certificate-id.test.ts`,
`src/lib/documents/status.test.ts`; plus additions to existing
`src/lib/documents/phiScanner.test.ts`, `src/app/actions/auth.test.ts`,
`src/lib/audit-reports/report-data.test.ts`. 505 tests total pass, tsc + eslint
clean.

## Module-level env var reads must be set inside `vi.hoisted()`

`src/app/api/webhooks/stripe/route.ts` reads `process.env.STRIPE_WEBHOOK_SECRET`
at **module-evaluation time** (`const webhookSecret = process.env...` outside
any function). Setting it in `beforeEach()` is too late — ES module imports
execute before ordinary top-level statements in the importing test file, so
`import { POST } from './route'` already ran with the var unset. Fix: set the
env var as the first line inside the `vi.hoisted(() => {...})` block (hoisted
bodies run before imports resolve). Same risk applies to any route file that
reads `process.env.X` outside a request handler — check before assuming
`beforeEach` env stubbing works.

## `@/lib/file-parser` must be mocked to import `course-ai-v4.6.ts` at all

Importing `src/app/actions/course-ai-v4.6.ts` (even just for
`checkCourseGenerationJobV46`) transitively pulls in `pdf-parse` via
`extractTextFromFile`. `pdf-parse`'s `index.js` has debug-mode top-level code
that throws `ENOENT: no such file or directory, open './test/data/05-versions-space.pdf'`
on import unless `@/lib/file-parser` is mocked. Always
`vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: vi.fn() }))` before
importing this module (or anything that imports it). `@/generated/prisma/client`
did NOT need mocking for this file (only a type-cast target, no runtime
Prisma-error-class usage like [[reminders-test-patterns]]'s P2002 case).

## Testing a module-private async race (settle-guard) via its public entrypoint

`processBackgroundV46` (wall-clock timeout + one-shot `settle()` guard against
a hung AI pipeline stage) is not exported. It was exercised indirectly through
the exported `generateCourseAndQuizV46`, using `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync()` and a controllable hung promise for the first
external call in the pipeline (`callVertexAI`, mocked via `@/lib/ai-client`).
Pattern:
1. Mock `callVertexAI` to return `new Promise(() => {})` (never resolves) to
   pin the pipeline at its very first await.
2. Mock `next/server`'s `after()` as `(cb) => { void cb(); }` (fire-and-forget,
   matching real semantics) via `vi.mock('next/server', async (importOriginal) => ({ ...await importOriginal(), after: mockAfter }))`.
3. `await vi.advanceTimersByTimeAsync(0)` to flush microtasks up to the hang
   point, then advance past `V46_GENERATION_TIMEOUT_MS` (set low via env var
   for test speed) to fire the timeout branch and assert `prisma.job.update`
   was called once with `status: 'failed'`.
4. To prove the settle-guard (no double-write), resolve the hung promise
   *after* the timeout already fired, with a payload that drives Stage A to
   its own failure branch, then advance timers through the retry backoff
   (1s+2s+3s) and assert `prisma.job.update` call count is still 1.
This avoids needing to mock the entire 5-stage pipeline — Stage A's failure
branch is reachable without Stage B–E.

## Pre-existing test bug fixed: bcryptjs mock missing `compare` on `default`

`src/app/actions/auth.test.ts`'s `vi.mock('bcryptjs', ...)` only put `hash` on
the `default` export; `compare` was only a named export. `auth.ts` does
`import bcrypt from 'bcryptjs'` and calls `bcrypt.compare(...)` — undefined
under the old mock, throwing `TypeError: default.compare is not a function`
the moment any test exercises `authenticate()`'s missing-user path. Fixed by
adding `compare: vi.fn().mockResolvedValue(false)` to the `default` object too.
Watch for this pattern generally: a `default: {...}` mock object must mirror
every method actually called via the default-imported binding, not just the
ones the original test author needed.

## `formatCertificateId` test fixture pitfall

Two "different enrollment ids" test fixtures that share the same first 8
characters (e.g. `enrollment-aaa-111` / `enrollment-bbb-222`, both starting
`enrollme`) will produce the *same* certificate id and falsely fail a
"produces different ids" assertion — `formatCertificateId` only uses
`id.substring(0, 8)`. Vary the first 8 characters in fixtures, not the suffix.

## THER-003 PHI fail-closed behavior change (superseded phiScanner.test.ts expectations)

`phiScanner.ts`'s `scanText` now ALWAYS fails closed (`hasPHI: true,
scanFailed: true`) on: no JSON in AI response, malformed JSON, unexpected
structure, or a thrown/rejected AI call — regardless of `PHI_FAIL_CLOSED` env
var (removed). The old test file asserted `{ hasPHI: false, findings: [] }`
(fail-open) for exactly these three scenarios; those assertions were rewritten
in place rather than left stale. `uploadDocument` in `documents.ts` also
checks a new `scanFailed` flag distinctly from `hasPHI` — a failed scan gets a
"could not verify, retry" message, a genuine PHI hit gets a different
"contains PHI" message with `phiDetected: true`.

## Async Server Component page testing pattern (no existing precedent before this)

`src/app/join/[token]/page.tsx` is an async Server Component with branching
logic (valid invite / already-accepted / notFound). No prior test in this repo
tested an async page component directly. Pattern used: call
`await JoinPage({ params: { token } })` directly to get the returned React
element, then `render(element)` from `@testing-library/react` and assert with
`screen`. Mock `next/navigation`'s `notFound` to `throw new Error('NEXT_NOT_FOUND')`
so the "genuinely unknown token" branch is assertable via
`await expect(JoinPage(...)).rejects.toThrow(...)`. Stub the heavy client
child component (`JoinPageClient`) entirely for the pending-invite branch —
only the page's own branching is under test. `Logo` (SVG-based) and shadcn
`Button`/`Link` rendered fine in jsdom with no extra mocking needed.

## Deferred Playwright e2e (not authored — see [[project-test-framework]] for e2e location convention)

Not created (per task scope — no live app/DB/Stripe available in this pass):
- `tests/e2e/billing-plan-swap.spec.ts` — admin changes plan on an org with an
  active subscription; assert no duplicate Stripe Checkout session opens and
  the UI reflects the swapped plan (needs a live Stripe test-mode account).
- `tests/e2e/staff-resend-invite.spec.ts` — admin resends an expired invite
  from the staff list; recipient's old link 404s, new link works end-to-end
  through `/join/[token]` to account creation (needs email capture/inbox).
- `tests/e2e/course-generation-timeout.spec.ts` — simulate a hung AI pipeline
  and confirm the UI shows the sanitized failure message, not raw stage
  detail, after polling (needs a way to force Vertex AI to hang in a live env).
- `tests/e2e/document-upload-phi-blocked.spec.ts` — upload a document that
  triggers fail-closed PHI blocking (via a forced scan failure) and confirm
  the "could not verify" message renders and no document appears in the list.

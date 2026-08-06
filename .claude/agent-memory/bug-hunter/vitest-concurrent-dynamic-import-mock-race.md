---
name: vitest-concurrent-dynamic-import-mock-race
description: Vitest silently drops vi.mock() interception for a dynamically-imported module when 2+ concurrent `await import(...)` calls to the SAME mocked specifier race — confirmed with a minimal repro, real SMTP calls fired. Affects any test that runs mocked, dynamically-imported code concurrently (e.g. Promise.all, bounded-concurrency worker pools).
metadata:
  type: feedback
---

**Rule: never trust `vi.fn()` call counts/args on a module reached via a
DYNAMIC `await import('specifier')` when the code under test invokes that
import path concurrently (`Promise.all`, a worker pool, etc.) more than once
in the same test run.** Confirmed with a minimal, isolated repro (no product
code involved): a function that does
`const { fn } = await import('@/lib/email'); await fn(tag)`, called via
`Promise.all([callIt('a'), callIt('b'), callIt('c')])` against a
`vi.mock('@/lib/email', () => ({ fn: mockFn }))`, only registers **the first**
call on `mockFn.mock.calls` — the other two silently fall through to the
**real, unmocked module** (observed firing an actual nodemailer SMTP
connection and logging its own internal "Missing credentials" error). Calling
the same function sequentially (`await callIt('a'); await callIt('b'); ...`)
works perfectly — all three hit the mock. Pre-warming the import with one
`await import(...)` before the `Promise.all` did NOT fix it — the race
reappears on every subsequent concurrent burst, not just the first-ever
import.

**Why:** This surfaced testing Tier 3 §5.3 PR-7 (`createEnrollmentsForUsers`
in `src/lib/enrollment/create.ts`, branch `feat/more-performance`, commit
`d8067bd`), which is the **first code in this repo to call
`createEnrollmentForUser` concurrently** (bounded worker pool, concurrency
10) — and `createEnrollmentForUser` does
`const { sendCourseInviteEmail, sendCourseLaunchEmail } = await import('@/lib/email');`
and `const crypto = await import('crypto');` **dynamically, inside the
function body, on every call**. A first pass at equivalence-testing the
batched vs. sequential paths showed `sendCourseLaunchEmail`/
`sendCourseInviteEmail` call counts diverging between the two paths (e.g. 51
calls instead of 60 for a 60-holder `assignCourseToRole` batch) — this looked
exactly like a real product concurrency bug, but tracing it down (temporary
`console.error` instrumentation directly in `create.ts`, reverted after,
`git checkout` confirmed clean) proved every code path was reached correctly
and `sendCourseLaunchEmail(...)` was truly *called* with the right args; the
call simply never registered on the mock for the "losing" concurrent
`import()`. **This is a Vitest/Vite dynamic-import mocking artifact, not a
real production hazard**: in real Node.js, concurrent `import()` calls to an
already-resolved specifier are deduplicated by the module loader and always
resolve to the identical cached module record — there is no race. Do not
report this class of "missing call" as a product bug without first ruling out
this exact test-infra cause via a sequential-vs-concurrent A/B (as above).

**How to apply:** When testing any function that is (a) invoked concurrently
by the code under test and (b) internally does `await import(...)` on a
mocked module:
- Prefer asserting on a **statically-imported** mock instead (e.g. `prisma`,
  imported via a top-level `import prisma from '@/lib/prisma'` in
  `create.ts`) — static-import mocks were rock-solid under the same
  concurrent load in every check performed here (`enrollment.create`,
  `invite.create` call counts and args never dropped a call, even at 60-way
  concurrency).
- If email/notification send-count precision genuinely matters, only assert
  it in a **single-entry** test, or a **duplicate-email** test where the repo
  batches same-email entries into one sequentially-processed group (so no
  concurrency touches that specific dynamic import in that test) — see
  `createEnrollmentsForUsers`'s per-email grouping in
  `src/lib/enrollment/create.ts`.
- For batches with 2+ distinct-email concurrent groups, drop precise
  email-mock call-count assertions entirely rather than asserting a
  guessed/observed-flaky number — that number is an artifact of this test
  run's race outcome, not a specification.
- If a genuinely-new module gets this dynamic-import treatment in future PRs,
  expect the same class of test flakiness under concurrency and route around
  it the same way; this is a Vitest-version-scoped limitation
  (`v4.1.8` at time of writing), not specific to this one module.

Related: none yet — first instance of this pattern encountered.

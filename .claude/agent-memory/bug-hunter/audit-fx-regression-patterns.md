---
name: audit-fx-regression-patterns
description: Gotchas from the feat/audit-fx security-fix wave (F-009/F-010 org isolation, F-039 score fallback, F-048 error-leak, F-038 email-leak)
metadata:
  type: project
---

Regression suite added on branch `feat/audit-fx` for six security/correctness
fixes. Files: additions to `src/app/actions/staff.test.ts` (getStaffDetails +
getEnrollmentQuizResult org-isolation describe blocks), new
`src/app/actions/certificate.test.ts` (score `?? 100` fallback), new
`src/app/api/documents/[versionId]/preview/route.test.ts` (F-048 sanitized
error response), new `src/app/verify-certificate/[id]/page.test.tsx` (F-038 no
email fallback/selection). 26 new tests, full suite 576/576 green after.

## Proved each test actually catches the regression, not just passes

Used `git diff -- <fixed files> > patch; git apply -R patch; npx vitest run
<new tests>; git apply patch` to temporarily revert the six product fixes,
confirmed all the corresponding new tests failed (10/26 failed exactly as
expected — the org-isolation, score, error-message, and email-leak
assertions), then reapplied the patch to restore the fixes. This is a strong
verification technique for security/negative-test work: a cross-tenant
isolation test that passes without ever having failed against the vulnerable
code is not trustworthy. Did NOT leave the revert in place — restored
immediately after observing the failures, per "do not modify product code."

## getEnrollmentQuizResult ordering: quizAttempts-empty check runs BEFORE the org check

`getEnrollmentQuizResult` in `src/app/actions/staff.ts` returns null on
`enrollment.quizAttempts.length === 0` *before* comparing organizationId. A
cross-org fixture with an empty quizAttempts array would pass the "returns
null" assertion for the wrong reason (empty attempts, not the org guard) —
always give the cross-org fixture at least one quizAttempt so the org check
is the thing actually exercised.

## Async Server Component pattern reused a second time (see [[qa-wave1-regression-patterns]])

`src/app/verify-certificate/[id]/page.tsx` is another async Server Component
(no client-side interactivity, `prisma.certificate.findUnique` then
conditional render). Same pattern as `join/[token]/page.test.tsx`: call
`await VerifyCertificatePage({ params: Promise.resolve({ id }) })` to get the
element, `render()` it, assert with `screen`. No extra mocking needed beyond
`@/lib/prisma` — `Logo`, lucide icons render fine in jsdom.

## Regression-testing a "select fewer fields" fix: assert the query shape, not just the render

For F-038 (verify-certificate page no longer selecting `user.email`), the
strongest test isn't just "the rendered fallback text is generic" — a
future edit could re-add `email` to the `select` without breaking that
assertion as long as `profile.fullName` is still present in the fixture.
Added `expect(call.select.user.select).not.toHaveProperty('email')` against
the actual `prisma.certificate.findUnique` call args to pin the query shape
itself, independent of what the render happens to show.

## Existing `staff.test.ts` already covered `resendInvite` only

Before this pass, `src/app/actions/staff.ts` had no tests for
`getStaffDetails` or `getEnrollmentQuizResult` at all (the file only tested
`resendInvite` from an earlier THER-007 wave). Extended the same file/mock
setup (added `enrollment: { findUnique: vi.fn() }` to the existing
`prismaMock`) rather than creating a second file, to reuse the established
`vi.hoisted` + `vi.mock('@/auth', ...)` scaffolding.

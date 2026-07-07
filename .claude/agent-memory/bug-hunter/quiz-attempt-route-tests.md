---
name: quiz-attempt-route-tests
description: F-031 quiz start/save/submit route test suite — append-history tx-mock pattern, boundary-score generation, and a flagged allowedAttempts null inconsistency
metadata:
  type: project
---

F-031 closed: `src/app/api/quiz/[id]/{start,save,submit}/route.test.ts` added
(29 tests, all green). Prior to this the three quiz routes had zero
automated tests despite being the core scoring/attempt-limit logic.

## Append-history model (post audit-fx)

`QuizAttempt` is no longer unique on `(enrollmentId, quizId)`. There can be
many completed rows (`timeTaken !== null`) plus at most one in-progress
draft (`timeTaken === null`). All three routes wrap their attempt-limit
check + mutation in `prisma.$transaction(async (tx) => ...)`, so the mock
needs a `txMock` object passed through `$transaction: vi.fn(async (cb) =>
cb(txMock))` — top-level `prismaMock.quizAttempt` is NOT what the routes
call inside the transaction.

- `start`: tx does `quizAttempt.findFirst` (resume draft) → `quiz.findUnique`
  + `quizAttempt.count` (completed count) → `quizAttempt.create` (new draft,
  `timeTaken: null`).
- `submit`: tx does `quizAttempt.count` (completed count, limit check) →
  `quizAttempt.deleteMany` (clear the leftover draft) → `quizAttempt.create`
  (new COMPLETED row, `attemptCount: completedCount + 1`). There is no
  `update` path for the historical record — always a fresh CREATE.
- `save`: no transaction; single `quizAttempt.findFirst({ orderBy:
  { completedAt: 'desc' } })` to find "the current attempt" (draft or, if
  none, whatever completed row happens to be latest — hence the 409 guard),
  then `quizAttempt.update`.

## Generating an exact score boundary needs enough questions

`score = Math.round((correctCount / totalQuestions) * 100)`. To test "one
point below passingScore" vs "exactly at passingScore" precisely (e.g. 69
vs 70 against `passingScore: 70`), you need `totalQuestions` granular enough
to hit that exact integer — 10 questions only produces multiples of 10. Used
a 100-question generator (`makeQuestions(n)` / `makeAnswers(n, correctCount)`
building question/answer arrays programmatically) to hit exact boundary
scores. All questions carry an embedded `explanation` field so
`generateExplanations()` takes the v3.1 embedded-explanations path and never
calls the mocked `@/lib/ai-client.callVertexAI` — avoids needing to script
AI-mock JSON responses for scoring-only tests.

## Auth pattern: real session claims, not a mocked auth-guard module

Per `[[project-test-framework]]` and the existing `billing/subscription/checkout/route.test.ts`,
`guardApiSession` (in `src/lib/auth-guard.ts`) is NOT mocked — it's a pure
function over session claims. Tests construct `{ user: { id, role,
mfaEnabled, mfaVerified } }` session objects directly (via the mocked
`@/auth` / `@/auth.worker`) and let the real guard logic run. This is
simpler and also verifies the guard wiring itself, not just that a mocked
gate returns null.

## Suspected product bug (reported, not fixed): allowedAttempts null-handling inconsistency

`quiz.allowedAttempts` is `Int?` (nullable, DB default 1) in `prisma/quiz.prisma`.
The two routes treat an explicit `null` differently:
- `start/route.ts`: `const allowedAttempts = quiz?.allowedAttempts ?? 1;` —
  null coerces to a limit of 1.
- `submit/route.ts`: `if (quiz.allowedAttempts && completedCount >=
  quiz.allowedAttempts)` — null (or 0) is falsy, so the limit check is
  skipped entirely (unlimited attempts).
If a quiz's `allowedAttempts` is ever explicitly `null` (not just left at
the DB default), `/start` would block after 1 completed attempt while
`/submit`, if reached directly, would allow unlimited submissions. Low
likelihood in normal flow (admin UI likely always sets an integer) but
worth a follow-up decision on canonical null-handling. Not fixed here per
"do not modify product code."

## Verification technique

Used the `[[audit-fx-regression-patterns]]` revert-and-confirm technique on
just the passing-score boundary: flipped `score >= quiz.passingScore` to
`score > quiz.passingScore` in `submit/route.ts`, reran, confirmed the
"exactly at passingScore" test failed as expected, then reverted (`git diff`
confirmed clean before finishing).

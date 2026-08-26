---
name: quiz-error-surfacing-tests
description: LearnClient quiz-error (alert-removal) test coverage — readQuizErrorMessage precedence, res.ok start-check regression guard, getByText exact-match trap on multi-expression JSX spans
metadata:
  type: project
---

Branch `fix/learner-quiz-and-slide-picker` (commit 7aa3a2f) replaced three native
`alert()` calls in `src/app/learn/[id]/LearnClient.tsx` with an in-page `quizError`
state rendered via the shared `Alert` (`role="alert"`). Covered in
`src/app/learn/[id]/LearnClient.test.tsx`, new describe block
`LearnClient — quiz error surfacing` (7 tests, all green; file is now 55/520 in the
`src/app/learn src/components` run, up from 55/513).

**What's pinned down:**
- `readQuizErrorMessage` (module-scope, not exported — tested only through fetch-mock
  response shapes) prefers `body.message` over `body.error`; the `/start` route puts a
  machine token (`QUIZ_LOCKED_MAX_ATTEMPTS`) in `error` and the human text in `message` —
  a test asserts the token never reaches the DOM.
- `/submit`'s 403 with `attemptsUsed`/`allowedAttempts` composes
  `"{error}. You have used {n} of {m} allowed attempts."`; without those two numeric
  fields it falls back to the bare `error` string; on unparsable JSON it falls back to
  the fixed constant.
- **The `res.ok` check on `/start` is the highest-value regression guard**: a 403 must
  leave `quizStep` at `'intro'` (Start Quiz button still present, no "Question 1 of N"
  text) — previously this fetch had no `res.ok` check at all and silently dropped the
  learner into an unsubmittable quiz.
- `window.alert` is spied and asserted never-called across every failure path.
- Retake failure shows the fixed `RETAKE_QUIZ_FALLBACK` string, never the thrown Error's
  real message (Next.js redacts Server Action throw messages in prod, so the component
  deliberately doesn't surface `err.message` here — unlike submit/start which do).
- A failed submit leaves the learner's already-selected answer marked
  `data-selected="true"` — confirms the fix didn't route through the full-page `error`
  state (which is a hard early-return that would unmount the quiz and discard answers).

**Testing-library gotcha hit while writing these:** the quiz header renders
`Question {n} of {total}{allowedAttempts && \` | Attempt ...\`}` as several JS
expressions inside one `<span>`, which RTL flattens into a single merged text node
(e.g. `"Question 1 of 2 | Attempt 1 of 3"`). `screen.getByText('Question 1 of 2')`
(exact string) fails against that — must use a regex (`/^Question 1 of 2/` or
`/^Question 1 of/`) since RTL's regex matcher does a partial `.match()`, not a full-string
equality check like the default string matcher does.

**Fixture pattern used:** `textCoursePayload()` overrides `makePayload()`'s single video
lesson with a plain text lesson, to test the quiz flow independent of the (separately
covered) video watch-gate. `activeAttemptPayload()` / `retakePendingPayload()` /
`reviewPendingRetakePayload()` reuse the existing `deriveSeed` branches (active draft →
`'active'`, no-draft-with-history → `'intro'`, scored-but-not-completed → `'review'`)
documented in the existing test file's header comment.

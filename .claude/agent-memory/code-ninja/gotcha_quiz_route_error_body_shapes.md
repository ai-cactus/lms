---
name: gotcha-quiz-route-error-body-shapes
description: /api/quiz/[id]/start puts a machine CODE in `error` and the human text in `message`; submit puts human text in `error` — read `message ?? error` or learners see QUIZ_LOCKED_MAX_ATTEMPTS
metadata:
  type: project
---

The two quiz route handlers disagree on their JSON error shape, so any client
that surfaces them must read `message ?? error`, never `error` alone.

- `/api/quiz/[id]/submit` — `{ error: '<human sentence>' }` throughout, plus
  `attemptsUsed` / `allowedAttempts` alongside the 403 `No attempts remaining`.
- `/api/quiz/[id]/start` — mostly human `error` strings, **but** the locked-
  enrollment 403 returns `{ error: 'QUIZ_LOCKED_MAX_ATTEMPTS', message: '<human
  sentence>' }`. Reading `error` there shows a learner a screaming-snake code.

**Why:** both are route handlers, not Server Actions, so their bodies reach the
client unredacted in production — they are the only diagnosable signal a learner
or a debugger gets. `retakeQuiz` in `src/app/actions/course.ts` is the opposite
case: it is a Server Action that `throw`s, so Next.js redacts its message in
prod builds and only the `logger.error` carries the real cause.

**How to apply:** when adding or moving a quiz error surface, reuse
`readQuizErrorMessage` in `src/app/learn/[id]/LearnClient.tsx` rather than
re-deriving the precedence. Never surface a Server Action's thrown message to a
user as if it were specific.

Related: [[gotcha_enrollment_failed_status_unused]],
[[gotcha_server_action_redirectto_must_render]]

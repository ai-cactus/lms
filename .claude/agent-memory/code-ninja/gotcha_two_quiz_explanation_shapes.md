---
name: gotcha-two-quiz-explanation-shapes
description: Quiz `explanation` has two incompatible shapes (flat string from the quiz AI actions, object from v4.6) and only correctExplanation is ever persisted
metadata:
  type: project
---

`explanation` on a quiz question exists in **two incompatible shapes**, and the
consumer decides which one it wants. Check the consumer before wiring a new
producer.

- **Flat `string`** — what `generateSingleQuestion` / `regenerateQuiz`
  (`src/app/actions/quiz-ai.ts`) return, and what `AdminQuizEditor` (the legacy
  course editor) stores and edits in a textarea.
- **Object `{ correctExplanation, incorrectOptions }`** (`QuizQuestion` in
  `src/types/quiz.ts`) — what the v4.6 pipeline produces (built in
  `GenerationController.tsx`, where `incorrectOptions` is keyed by the
  **post-shuffle** option index) and what the wizard's Step 6 card renders.

**Why:** the wizard step and the legacy editor were built against different
generators and never converged. Nothing in the type system connects them —
`QuizQuestion` is not what the server action returns — so a flat string assigned
where the object is expected renders as a blank "Correct: " rather than failing.

**How to apply:**
- Feeding a quiz-AI action result into Step 6 requires widening the string into
  the object (`toQuestionExplanation` in `Step6QuizReview.tsx`). Feeding it into
  `AdminQuizEditor` requires the raw string. Do not "unify" one into the other
  without touching both consumers.
- **Only `correctExplanation` is persisted.** `createFullCourse`
  (`src/app/actions/course.ts`) writes `q.explanation?.correctExplanation` into
  `Question.explanation`, which is a `String?`. `incorrectOptions` is
  wizard-preview-only and never reaches the database — so per-distractor
  rationales are cosmetic, and a fix that leaves that map empty still achieves
  full DB parity.

See also [[gotcha_rsc_vs_json_payload_shapes]] for the same class of
one-field-two-shapes trap.

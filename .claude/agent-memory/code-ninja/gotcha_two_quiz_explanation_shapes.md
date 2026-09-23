---
name: gotcha-two-quiz-explanation-shapes
description: Every AI quiz path now returns the rich {correctExplanation, incorrectOptions} object, but only correctExplanation is ever persisted — per-option rationale is author-preview-only
metadata:
  type: project
---

Since Q-13 (2026-09-23) **all three AI quiz producers return the same object**,
`QuizExplanation` from `src/types/quiz.ts`:

- `generateSingleQuestion` / `regenerateQuiz` (`src/app/actions/quiz-ai.ts`)
- the v4.6 pipeline (adapted in `GenerationController.tsx`)

They share `adaptQuizOptions` (`src/lib/quiz/options.ts`), which shuffles the
options and keys `incorrectOptions` by the **post-shuffle** index. So `answer`
is positional and cannot be asserted against a fixed number in a test — assert
`options[answer] === '<the correct text>'` instead.

The one surviving flat-`string` consumer is **`AdminQuizEditor`** (the legacy
post-publication editor): it stores what `Question.explanation` holds, so it
reads `res.question.explanation.correctExplanation` and drops the rest.

**Only `correctExplanation` is persisted — still.** `Question.explanation` is a
single `String?` (`prisma/quiz.prisma`); `createFullCourse` writes
`q.explanation?.correctExplanation`, `updateQuizQuestions` writes the flat
string, and the learner's `/api/quiz/[id]/submit` serves one explanation per
question. `incorrectOptions` reaches the wizard's Step 6 card and nothing else,
by design — the author reviewing before publish is its reader. Tracked as an
open follow-up on Q-13; making it learner-visible needs a `Question` column AND
a product ruling, and would have to cover the bulk path too.

**How to apply:** a change that "adds" per-option rationale to a producer is
cosmetic unless it also adds a column and a learner surface — say so rather
than implying learners will see it.

See also [[gotcha_rsc_vs_json_payload_shapes]] for the same class of
one-field-two-shapes trap.

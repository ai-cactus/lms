---
name: gotcha-two-quiz-explanation-shapes
description: One QuizExplanation object in memory, TWO columns on disk — correctExplanation to Question.explanation, incorrectOptions to Question.incorrectOptionExplanations, keyed by post-shuffle index
metadata:
  type: project
---

Since Q-13 (2026-09-23) **all AI quiz producers return the same object**,
`QuizExplanation` from `src/types/quiz.ts`:

- `generateSingleQuestion` / `regenerateQuiz` (`src/app/actions/quiz-ai.ts`)
- the v4.6 pipeline (adapted in `GenerationController.tsx`)

They share `adaptQuizOptions` (`src/lib/quiz/options.ts`), which shuffles the
options and keys `incorrectOptions` by the **post-shuffle** index. So `answer`
is positional and cannot be asserted against a fixed number in a test — assert
`options[answer] === '<the correct text>'` instead.

**One object, two columns.** Q-19 (2026-09-24) made the per-option rationale
learner-visible, so `QuizExplanation` now splits across two `Question` columns:

| in memory            | on disk                                          |
| -------------------- | ------------------------------------------------ |
| `correctExplanation` | `Question.explanation` (`String?`)               |
| `incorrectOptions`   | `Question.incorrectOptionExplanations` (`Json?`) |

The Json map is keyed by the option's index in **that row's own `options`
array**. It is written in the same statement as `options` by every writer, and
`updateQuizQuestions` — which reshuffles what the author sends — re-keys it
through the same permutation (`remapOptionExplanations`). Never store `{}`:
`toStoredOptionExplanations` returns `undefined` for an empty map, because an
empty object reads as "has rationale" downstream and draws an empty block.

Readers go through `parseStoredOptionExplanations` and attach the rationale to
the option object (`options[].explanation`) rather than passing the raw map
down — four builders serve the same `QuizResults` payload and must not drift:
`/api/quiz/[id]/submit`, `getLearnPayload`, `getEnrollmentQuizResult`
(`staff.ts`) and the `/dashboard/training/courses/[id]/results/[enrollmentId]`
page.

⛔ **The map is ANSWER KEY.** It names which options are wrong, so
`getLearnPayload` puts it in the admin-only branch beside `correctAnswer` —
never in the quiz a learner is about to sit. It is fine in the graded-review
payloads, which only exist after the attempt.

`AdminQuizEditor` (the legacy post-publication editor) is the trap:
`updateQuizQuestions` deletes and recreates the whole question set from what it
sends, so a field this editor forgets is erased for EVERY question in the
course, not just the edited one. It round-trips the map and drops an entry when
the author rewrites that option's text — as does the wizard's `Step6QuizReview`
(`dropOptionExplanation`). Any NEW option-text editor needs the same call, or it
will leave a rationale describing an answer that is no longer on screen.

Video-course quizzes (`src/app/actions/video-course.ts`) and
`createLessonWithQuiz` (`lesson.ts`) are hand-authored, carry no per-option
rationale in their input shape, and store NULL.

See also [[gotcha_rsc_vs_json_payload_shapes]] for the same class of
one-field-many-shapes trap.

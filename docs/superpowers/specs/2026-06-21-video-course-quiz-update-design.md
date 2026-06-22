# Video Course Quiz Update (Re-upload) — Design

**Date:** 2026-06-21
**Status:** Implemented
**Area:** System back-office — `/system/video-courses/[courseId]/edit`

## Problem

When the soft-delete + edit work shipped (`2026-06-16-video-course-soft-delete-and-edit-design.md`), quiz editing was deliberately left **out of scope**: the edit page showed the question count and passing score but the quiz itself was read-only ("The quiz has N questions and is not editable here"). A system admin who needed to fix a typo, swap a wrong answer, or refresh the whole question set had no path short of deleting and recreating the course — which would orphan the old course (soft-deleted, never removed) and lose its enrollment history.

## Decision

Let a system admin **replace the quiz file** from the existing edit page. The mechanism mirrors course creation:

- The admin uploads a new **CSV or JSON** quiz file (same schema, parser, and samples as create).
- Uploading a file performs a **full replace**: every existing `Question` row for the course's quiz is deleted and recreated from the file.
- Leaving the picker empty keeps the existing quiz untouched (the field is optional in edit mode).

Alternatives considered and rejected for this round: an inline question-by-question editor (more surface area; the file flow matches how these quizzes are authored), and merge/patch semantics (ambiguous — admins think in whole files).

### Why full replace is safe

`QuizAttempt` rows reference the **`Quiz`** (not individual `Question` rows), so wiping and recreating questions does **not** cascade-delete attempts. Past attempts, scores, certificates, and attestation history are preserved. The replacement is the admin's explicit, confirmed intent (the picker copy states it overwrites every question).

## UX (`VideoCourseForm` + `EditVideoCourseClient`)

- The shared `VideoCourseForm` already renders a quiz picker on create. Two new optional props generalize it:
  - `quizRequired?: boolean` (default `true`) — create keeps the file mandatory; edit sets it `false`.
  - `currentQuestionCount?: number` — edit shows "Current quiz: N questions" next to the picker.
- In edit mode the picker reads "Replace quiz file (CSV or JSON)", explains that a new upload replaces every question and that leaving it empty keeps the current quiz, and keeps the CSV/JSON sample download links.
- The edit page heading no longer says the quiz is "not editable here".
- The quiz file is **parsed on the client** (`parseQuizFile`) before the action is called, so format errors surface immediately with the same row-number detail as create (`QuizImportError.rows`). No DB write happens unless parsing succeeds.

## Server (`updateVideoCourse`)

`UpdateVideoCourseInput` gains an optional `quiz?: ParsedQuiz`. Inside the existing `prisma.$transaction`:

1. **Scoring:** a replacement quiz file's `passingScore` / `allowedAttempts` win over the form fields when present (parity with `createVideoCourse`), then the course-level `Quiz` scoring is updated as before.
2. **Questions (only when `input.quiz` is provided):** look up the quiz by `courseId`. If it exists, `deleteMany` its questions; otherwise create the quiz row (defensive — a video course always has one). Then `createMany` the new questions (`type: 'multiple-choice'`, options/correctAnswer/explanation/order from the parsed file).

When `input.quiz` is omitted, the question rows are never touched — existing edit behavior is unchanged.

## Auth

Unchanged. `updateVideoCourse` is gated by `assertSystemAdmin()` (the `system_admin_auth` cookie); the edit page and the parser run only for an authenticated system admin.

## Testing

Extend `src/app/actions/video-course.test.ts` `updateVideoCourse` suite:

- No `quiz` provided → questions are neither deleted nor created.
- `quiz` provided → existing questions `deleteMany`'d and new ones `createMany`'d against the existing quiz id.
- A replacement file's `passingScore` / `allowedAttempts` override the form values.
- Replacing on a course whose quiz row is missing creates the quiz, skips the delete, and still creates questions.

Parser behavior (CSV/JSON validation, row numbers) is already covered by `src/lib/video/quiz-import.test.ts` and is reused unchanged.

## Out of scope

- Inline per-question editing on the system edit page.
- Editing quizzes for org-scoped **text** courses (that already has its own inline editor, `AdminQuizEditor`).
- Versioning / history of replaced quizzes.

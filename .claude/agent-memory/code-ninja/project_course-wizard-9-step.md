---
name: course-wizard-9-step
description: Course wizard history 7→9→7 steps, and the 2026-09-11 single-document (D1) reshape — current step keys/filenames, plus the decisions that look like oversights but are not
metadata:
  type: project
---

**Current ladder (after PR-3a, 2026-09-11):** seven steps, keyed
`category | upload | details | quiz | generate | quizReview | assign`
(`src/components/dashboard/courses/wizardSteps.ts`). Files:
`Step1Category`, `Step2Upload`, `Step3Details`, `Step4Quiz`,
`GenerationController`, `Step6QuizReview`, `Step7Assign`. Earlier names
(`Step2Modules`, `Step4Details`, `Step5Quiz`, `Step8QuizReview`,
`Step9AssignPublish`, `Step5Review`, `Step7Publish`) are all gone — the wizard
had been renumbered 7 → 9 for a Figma set that was later cut back to 7, so the
filenames spent a while disagreeing with the step numbers.

**D1 (2026-09-11):** step 2 accepts exactly ONE document, so every new course is
one module. `formData.modules` stays an array of length 0-1, and
`CourseWizardModule` narrowed to just the document reference — title, objective
and `completionDeadlineDays` now come from the course-level fields.
`GenerationController` reads `data.title` / `data.objectives` where it used to
read the wizard module. The fan-out (`startModuleGenerationJobs`,
`useMultiJobStatus`, `distributeQuestionCount`, `mergeModuleArtifacts`,
`isWholeCourse`) is deliberately KEPT: D1 restricts creation, not history, and
existing multi-module courses must keep rendering.

Deliberate, not oversights:

- `CourseAssignment.targetRole` is still written (= first role) alongside
  `targetRoles`, because the nightly reminder sweep's role-target reconcile
  pre-pass (`src/lib/reminders/sweep.ts`) reads the single column — **the sweep
  therefore backstops only the FIRST targeted role; the live hook
  `enrollUserForRoleTargets` covers all of them.** Migrating the sweep is open.
- The wizard's "N days before" reminder rows are capped at 3 because they map
  onto the three worker-audience ladder stages (FRIENDLY_REMINDER /
  URGENT_REMINDER / DAY_OF_DEADLINE).
- In **email** mode the reminder rows and recurring interval are collected but
  NOT persisted — that path goes through `createFullCourse` → `enrollUsers` with
  only a `dueAt`.
- The `generate` step renders two sub-phases from one component (interstitial,
  then the aggregated review) and reports "Step 4 of 7" for the first —
  see `displayStepNumber` and [[gotcha_wizard_draft_key_bump_orphans_generation]].
- Course-level raw v4.6 artifacts on `Course` are a MERGE of every module's
  artifacts, each section/slide/question tagged `moduleIndex`; ids are unique
  only within a module, so key on `(moduleIndex, sectionId)`.

Closed since: "Regenerate Quiz" now exists (`regenerateQuiz` in
`src/app/actions/quiz-ai.ts`, own rate-limit budget `quiz-regenerate:`).

Still open: **`docs/phi-redactor.md` is stale** — it documents
`steps/Step2Documents.tsx`, `PhiErrorModal.tsx` and an `isScanningPhi` prop that
no longer exist. It needs a rewrite against the current PHI flow, not a path
swap. The generation step's subtitle also promises an email notification that
does not exist (no generation-complete type in `src/lib/notifications/catalog.ts`).

See [[course-wizard-phi-attestation]] and [[local-ui-verification]].

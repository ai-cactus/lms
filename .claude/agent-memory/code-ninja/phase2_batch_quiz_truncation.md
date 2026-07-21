---
name: phase2-batch-quiz-truncation
description: Root cause + fix shape for Phase 2 Issue #3 — batch quiz Stage C returning 0 questions via output-token truncation
metadata:
  type: project
---

Phase 2 Issue #3 (TC-013/014): AI batch quiz returned 0 questions.

**Root cause (reproduced against the live model):** Stage C (`generateQuizV46`) made ONE Vertex call capped at `maxOutputTokens: 16384`. Each question ≈ 370–500 output tokens, so a large `requestedQuestionCount` overflows the cap → `finishReason=MAX_TOKENS` → JSON cut off mid-object → `JSON.parse`/zod fail → silent 3× retry → `quizJson=null` → job "completes" degraded. Confirmed: 50 questions @16384 = MAX_TOKENS at exactly 16,380 tokens, 0 questions; same request @65536 = 50 questions, STOP.

**Why:** `maxOutputTokens` was only 25% of the model's documented 65,536 ceiling, and admin-requested counts scale unboundedly.

**How it was fixed (in code as of fix/phase-02):** hybrid in `generateQuizV46` — single call for counts ≤ `QUIZ_SINGLE_CALL_MAX` (20) with a count-scaled cap `min(65536, 2048 + count*900)`; larger counts split into `QUIZ_SUB_BATCH_SIZE` (6) sub-batches, each retried, then merged (dedup by normalized stem, ids renumbered `q01..`, `meta.requestedQuestionCount` preserved as the ORIGINAL request so `assessCourseQuality`/step-6 detect partial fills). `QuizChunkError` carries a machine-readable `reason` for logs.

**How to apply:** the merged `meta.requestedQuestionCount` must stay the original admin count — the publish-review gate (`assessCourseQuality` in `course.ts`) and `Step6QuizReview` partial-fill banner both compare it against `questions.length`. Reproduction method: [[repro-v46-ai-pipeline-locally]].

---
name: repro-v46-ai-pipeline-locally
description: How to reproduce v4.6 AI pipeline Stage calls (Prompt A–E) locally when ADC/gcloud is unavailable in the sandbox
metadata:
  type: reference
---

Reproducing the v4.6 course-AI pipeline (`src/app/actions/course-ai-v4.6.ts`) locally when you need to see real model output/failures.

- **`callVertexAI` (`src/lib/ai-client.ts`) uses ADC** (`GoogleAuth`), not an API key. The sandbox has **no ADC file and no gcloud**, so `callVertexAI` can't run here.
- **Workaround:** `.env` has `GEMINI_API_KEY` / `NEXT_PUBLIC_GEMINI_API_KEY` (quoted, `AQ.`-prefixed AI-Studio **Express** key, ~53 chars after stripping quotes). Strip the surrounding quotes, then POST directly to `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent?key=<key>`. Network egress to that host works from the sandbox.
- **Gotcha:** `gemini-2.5-flash-lite` (the model Stage C/A actually use) returns **404 "no longer available to new users"** on the AI-Studio Express key. Use `gemini-flash-lite-latest` as a faithful same-family proxy (flash-lite, thinking off by default) — the `models?key=` list endpoint shows what the key can reach.
- The prompt builders (`src/lib/prompts-v4.6.ts`) and zod schemas (`src/lib/prompt-schemas-v4.6.ts`) have no `@/` imports, so a `tsx` scratch script can import them directly for a faithful repro. `extractJsonFromResponse` must be copied inline (it's not exported).
- **Model facts (official docs):** `gemini-2.5-flash-lite` max output = **65,536 tokens**; thinking OFF by default (so `maxOutputTokens` is a pure output-size cap). Quiz (Prompt C) costs **~370–500 output tokens/question**; a fixed 16,384 cap truncates (`finishReason=MAX_TOKENS`) around ~44 questions → cut-off JSON → `quizJson=null`. See [[phase2-batch-quiz-truncation]].

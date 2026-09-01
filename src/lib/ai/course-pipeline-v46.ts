/**
 * v4.6 course-generation AI stages.
 *
 * ── Why this is NOT in src/app/actions ──────────────────────────────────────
 * These are internal pipeline stages, and they used to live in
 * `src/app/actions/course-ai-v4.6.ts`, which carries `'use server'`. In that
 * module every exported async function becomes a Next.js Server Action — a live
 * HTTP endpoint whose action id ships in the client bundle and can be POSTed
 * directly, bypassing the UI entirely.
 *
 * That made `generateArticleV46` and `generateQuizV46` unauthenticated,
 * unrate-limited, PHI-ungated endpoints that took caller-supplied text straight
 * to Vertex AI at maxOutputTokens 16384 — in effect an open LLM proxy on the
 * project's Vertex billing. Neither had any external caller; one was exported
 * only so a test could import it (finding F-084).
 *
 * Adding an auth check inside them was NOT an option: they run inside
 * background pipeline stages where no request session exists, so a session
 * check would break generation. Moving them to a plain module is the fix —
 * they stay freely exported and directly testable, while ceasing to be
 * action endpoints. The only public entry points remain
 * `generateCourseAndQuizV46` (which gates on `scanText`) and
 * `checkCourseGenerationJobV46`.
 *
 * Keep this module free of `prisma`, `auth`, and request-scoped state: these
 * stages are pure AI orchestration over text, which is what makes them safe to
 * expose and cheap to test.
 */

import { logger } from '@/lib/logger';
import { callVertexAI } from '@/lib/ai-client';
import {
  buildPromptA_v46,
  buildPromptB_v46,
  buildPromptC_v46,
  buildPromptD_v46,
  buildPromptE_v46,
} from '@/lib/prompts-v4.6';
import {
  ArticleMetaV46Schema,
  SlidesV46Schema,
  QuizV46Schema,
  JudgeV46Schema,
  RegenV46Schema,
} from '@/lib/prompt-schemas-v4.6';
import type {
  ArticleMetaV46,
  SlidesV46,
  QuizV46,
  JudgeV46,
  QuizQuestionV46,
  QuizDifficulty,
} from '@/lib/prompt-types-v4.6';

/**
 * Thrown when the source document cannot support generation (too short, no
 * extractable detail). Non-retryable: the orchestrator surfaces it as a
 * user-actionable message rather than retrying.
 */
export class InsufficientSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientSourceError';
  }
}

// ─── JSON extraction helpers ─────────────────────

function extractJsonFromResponse(text: string): string {
  const clean = text.trim();

  // Try to extract from ```json fence first
  const fenceMatch = clean.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try generic fence
  const genericFenceMatch = clean.match(/```\s*([\s\S]*?)```/);
  if (genericFenceMatch) {
    return genericFenceMatch[1].trim();
  }

  // Try to find the JSON object directly
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return clean.substring(firstBrace, lastBrace + 1);
  }

  return clean;
}

/**
 * Parse Prompt A's dual output: JSON (in ```json fence) THEN Markdown.
 * Returns { jsonStr, markdown } or throws.
 */
function parseDualOutput(rawResponse: string): { jsonStr: string; markdown: string } {
  const text = rawResponse.trim();

  // 1. Try to find the JSON block using regex to capture the JSON and the rest
  // This handles ```json ... ``` and generic ``` ... ``` fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```([\s\S]*)/i);
  if (fenceMatch) {
    let markdown = fenceMatch[2].trim();
    // Strip any leading/trailing markdown fences from the article itself
    if (markdown.startsWith('```markdown')) {
      markdown = markdown
        .replace(/^```markdown\s*/, '')
        .replace(/```\s*$/, '')
        .trim();
    }
    return {
      jsonStr: fenceMatch[1].trim(),
      markdown,
    };
  }

  // 2. Fallback: No closing fence found, or no fences at all.
  // Find the first { and the last } in the response
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    const jsonStr = text.substring(firstBrace, lastBrace + 1).trim();
    let markdown = text.substring(lastBrace + 1).trim();

    // Clean up any stray fences in the markdown
    if (markdown.startsWith('```')) {
      markdown = markdown.replace(/^```(?:markdown)?\s*/i, '');
    }
    if (markdown.endsWith('```')) {
      markdown = markdown.replace(/```\s*$/, '');
    }

    return { jsonStr, markdown: markdown.trim() };
  }

  // 3. Absolute fallback (if it's completely malformed)
  throw new Error('Could not parse dual output: No valid JSON block or fences found.');
}

// ─── Stage A: Article + ArticleMeta Generation ──

export async function generateArticleV46(
  sourceText: string,
  ragContext?: string,
  metadataJson?: string,
): Promise<{ articleMeta: ArticleMetaV46; articleMarkdown: string; rawArticleMetaJson: string }> {
  const prompt = buildPromptA_v46(sourceText, ragContext, metadataJson);

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.7,
      maxOutputTokens: 16384,
      telemetry: { stage: 'article' },
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Article Generation:', err: error });
    throw new Error(`Vertex AI API Error (Article): ${(error as Error).message}`);
  }

  const { jsonStr, markdown } = parseDualOutput(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error({
      msg: '[v4.6] Failed to parse JSON from Vertex AI (ArticleMeta). Raw Response:',
      rawResponse,
    });
    throw new Error(
      `Failed to parse ArticleMeta JSON from Vertex AI response. Raw Response: ${rawResponse.substring(0, 500)}...`,
    );
  }

  const result = ArticleMetaV46Schema.safeParse(parsed);
  if (!result.success) {
    // Check if this is a legitimate needs_sources response before throwing
    const meta = (parsed as { meta?: { status?: string; gaps?: string[] } })?.meta;
    if (meta?.status === 'needs_sources') {
      const gaps = meta.gaps ?? [];
      logger.info({
        msg: '[v4.6] ArticleMeta indicates insufficient source content (needs_sources)',
        gaps,
      });
      throw new InsufficientSourceError(`Insufficient source material: ${gaps.join('; ')}`);
    }

    logger.error({
      msg: '[v4.6] ArticleMeta validation failed:',
      data: JSON.stringify(result.error.format(), null, 2),
    });
    logger.error({ msg: '[v4.6] ArticleMeta Raw Invalid JSON:', err: jsonStr });
    throw new Error(
      `ArticleMeta validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return {
    articleMeta: result.data as ArticleMetaV46,
    articleMarkdown: markdown,
    rawArticleMetaJson: jsonStr,
  };
}

// ─── Stage B: Slides Generation ──────────────────

export async function generateSlidesV46(
  articleMarkdown: string,
  articleMetaJson: string,
  desiredSlideCount: number,
): Promise<{ slidesJson: SlidesV46; raw: string }> {
  const prompt = buildPromptB_v46(articleMarkdown, articleMetaJson, desiredSlideCount);

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.4,
      maxOutputTokens: 8192,
      telemetry: { stage: 'slides' },
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Slides Generation:', err: error });
    throw new Error(`Vertex AI API Error (Slides): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error({
      msg: '[v4.6] Failed to parse JSON from Vertex AI (Slides). Raw Response:',
      rawResponse,
    });
    throw new Error(
      `Failed to parse Slides JSON from Vertex AI response. Raw Response: ${rawResponse.substring(0, 500)}...`,
    );
  }

  const result = SlidesV46Schema.safeParse(parsed);
  if (!result.success) {
    logger.error({
      msg: '[v4.6] Slides validation failed:',
      data: JSON.stringify(result.error.format(), null, 2),
    });
    logger.error({ msg: '[v4.6] Slides Raw Invalid JSON:', err: jsonStr });
    throw new Error(
      `Slides validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return { slidesJson: result.data as SlidesV46, raw: jsonStr };
}

// ─── Stage C: Quiz Generation ────────────────────

// Documented output ceiling for the Stage C model (gemini-2.5-flash-lite):
// 65,536 output tokens per Vertex AI / Gemini model reference. The previous
// fixed 16,384 cap was only ~25% of this and silently TRUNCATED large quizzes
// (finishReason=MAX_TOKENS → cut-off JSON → parse failure → 0 questions).
const QUIZ_MODEL_MAX_OUTPUT_TOKENS = 65536;

// Each quiz question costs ~370–500 output tokens in practice (stimulus + 4
// options each with a 12–100-word explanation + metadata). Budget ~2× that so a
// verbose batch never brushes the ceiling.
const QUIZ_OUTPUT_TOKENS_PER_QUESTION = 900;
const QUIZ_BASE_OUTPUT_TOKENS = 2048;

// Admin-requested counts scale unboundedly, so a single call can always be made
// to truncate. Counts at or below the single-call threshold fit comfortably in
// one request under the count-scaled cap (empirically ~370 output tokens/
// question, so ~20 questions ≈ 7.5k tokens ≪ ceiling); larger counts are split
// into small sub-batches so no single call can ever brush the output cap — the
// robust fix for the unbounded case, and it lets a partial batch still return
// questions instead of zeroing the whole quiz.
const QUIZ_SINGLE_CALL_MAX = 20;
const QUIZ_SUB_BATCH_SIZE = 6;
const QUIZ_CHUNK_MAX_ATTEMPTS = 2;

type QuizChunkFailureReason = 'api_error' | 'parse_error' | 'validation_error';

// Carries a machine-readable reason so a degraded quiz stage is diagnosable
// from structured logs rather than a free-text message.
class QuizChunkError extends Error {
  readonly reason: QuizChunkFailureReason;
  constructor(reason: QuizChunkFailureReason, message: string) {
    super(message);
    this.name = 'QuizChunkError';
    this.reason = reason;
  }
}

function quizOutputTokenBudget(count: number): number {
  return Math.min(
    QUIZ_MODEL_MAX_OUTPUT_TOKENS,
    QUIZ_BASE_OUTPUT_TOKENS + count * QUIZ_OUTPUT_TOKENS_PER_QUESTION,
  );
}

function planQuizChunks(total: number): number[] {
  const target = Math.max(0, Math.floor(total));
  if (target === 0) return [];
  // Small/typical requests stay a single call — cheaper, faster, and no risk of
  // duplicate questions across independently-generated sub-batches.
  if (target <= QUIZ_SINGLE_CALL_MAX) return [target];

  const chunks: number[] = [];
  let remaining = target;
  while (remaining > 0) {
    const n = Math.min(QUIZ_SUB_BATCH_SIZE, remaining);
    chunks.push(n);
    remaining -= n;
  }
  return chunks;
}

/**
 * Generate a single quiz sub-batch. One Vertex call, one parse, one validation —
 * throws a {@link QuizChunkError} tagged with a machine-readable reason on any
 * failure so the orchestrator can retry the chunk and log why it failed.
 */
async function generateQuizChunkV46(
  articleMarkdown: string,
  articleMetaJson: string,
  count: number,
  quizDifficulty: QuizDifficulty,
  ragContext: string,
): Promise<QuizV46> {
  const prompt = buildPromptC_v46(
    articleMarkdown,
    articleMetaJson,
    count,
    quizDifficulty,
    ragContext,
  );

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.5,
      maxOutputTokens: quizOutputTokenBudget(count),
      telemetry: { stage: 'quiz' },
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Quiz Generation:', err: error });
    throw new QuizChunkError(
      'api_error',
      `Vertex AI API Error (Quiz): ${(error as Error).message}`,
    );
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error({
      msg: '[v4.6] Failed to parse JSON from Vertex AI (Quiz). Raw Response:',
      err: rawResponse,
    });
    throw new QuizChunkError(
      'parse_error',
      `Failed to parse Quiz JSON from Vertex AI response. Raw Response: ${rawResponse.substring(0, 500)}...`,
    );
  }

  const result = QuizV46Schema.safeParse(parsed);
  if (!result.success) {
    logger.error({
      msg: '[v4.6] Quiz validation failed:',
      data: JSON.stringify(result.error.format(), null, 2),
    });
    logger.error({ msg: '[v4.6] Quiz Raw Invalid JSON:', err: jsonStr });
    throw new QuizChunkError(
      'validation_error',
      `Quiz validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return result.data as QuizV46;
}

/**
 * Merge sub-batch quizzes into one. Questions are de-duplicated by normalized
 * stem (independent chunks can pick the same snippet) and re-numbered so ids
 * stay unique for the downstream judge/regen stages. `requestedQuestionCount` is
 * preserved as the ORIGINAL admin request so the publish-review gate and step-6
 * UI can detect a partial fill.
 */
function mergeQuizChunks(
  chunks: QuizV46[],
  requestedQuestionCount: number,
  quizDifficulty: QuizDifficulty,
): QuizV46 {
  const merged: QuizQuestionV46[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const q of chunk.questions) {
      const key = q.question.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...q, id: `q${String(merged.length + 1).padStart(2, '0')}` });
    }
  }

  const baseMeta = chunks[0].meta;
  return {
    ...chunks[0],
    meta: {
      ...baseMeta,
      requestedQuestionCount,
      quizDifficulty,
      totalQuestions: merged.length,
    },
    questions: merged,
  };
}

/**
 * Stage C orchestrator: generate `requestedQuestionCount` questions as bounded
 * sub-batches, retry each independently, then merge. Returns as many valid
 * questions as were produced (a partial batch is surfaced to the wizard via the
 * preserved `requestedQuestionCount`); throws only when EVERY sub-batch failed.
 */
// Exported (still async, so this stays valid in a 'use server' module — see the
// assessCourseQuality comment above for the constraint) solely so the chunking
// orchestration (single-call vs sub-batch planning, dedup/renumbering, partial
// results, requestedQuestionCount preservation) is unit-testable in isolation
// from the full processBackgroundV46 pipeline. No behavior change.
export async function generateQuizV46(
  articleMarkdown: string,
  articleMetaJson: string,
  requestedQuestionCount: number,
  quizDifficulty: QuizDifficulty,
  ragContext: string = '',
): Promise<{ quizJson: QuizV46; raw: string }> {
  const plan = planQuizChunks(requestedQuestionCount);
  const succeeded: QuizV46[] = [];
  let failedChunks = 0;
  let lastReason: QuizChunkFailureReason | 'unknown' = 'unknown';

  for (let i = 0; i < plan.length; i++) {
    const count = plan[i];
    let chunkOk = false;
    for (let attempt = 1; attempt <= QUIZ_CHUNK_MAX_ATTEMPTS; attempt++) {
      try {
        succeeded.push(
          await generateQuizChunkV46(
            articleMarkdown,
            articleMetaJson,
            count,
            quizDifficulty,
            ragContext,
          ),
        );
        chunkOk = true;
        break;
      } catch (err) {
        lastReason = err instanceof QuizChunkError ? err.reason : 'unknown';
        logger.warn({
          msg: `[v4.6] Quiz sub-batch ${i + 1}/${plan.length} attempt ${attempt}/${QUIZ_CHUNK_MAX_ATTEMPTS} failed`,
          reason: lastReason,
          err: (err as Error).message,
        });
        if (attempt < QUIZ_CHUNK_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    if (!chunkOk) failedChunks += 1;
  }

  const merged =
    succeeded.length > 0
      ? mergeQuizChunks(succeeded, requestedQuestionCount, quizDifficulty)
      : null;

  if (!merged || merged.questions.length === 0) {
    logger.error({
      msg: '[v4.6] Quiz generation produced 0 questions',
      reason: 'all_sub_batches_failed',
      lastReason,
      requestedQuestionCount,
      failedChunks,
    });
    throw new Error(
      `Quiz generation failed: all ${plan.length} sub-batches failed (${lastReason})`,
    );
  }

  if (merged.questions.length < requestedQuestionCount) {
    logger.warn({
      msg: '[v4.6] Quiz generation degraded (partial batch)',
      reason: 'partial',
      requestedQuestionCount,
      produced: merged.questions.length,
      failedChunks,
    });
  }

  return { quizJson: merged, raw: JSON.stringify(merged) };
}

// ─── Stage D: Judge ──────────────────────────────

export async function judgeQuizV46(
  quizJson: string,
  articleMetaJson: string,
): Promise<{ judgeJson: JudgeV46; raw: string }> {
  const prompt = buildPromptD_v46(quizJson, articleMetaJson);

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.2,
      maxOutputTokens: 8192,
      telemetry: { stage: 'judge' },
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Judge Generation:', err: error });
    throw new Error(`Vertex AI API Error (Judge): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error({
      msg: '[v4.6] Failed to parse JSON from Vertex AI (Judge). Raw Response:',
      err: rawResponse,
    });
    throw new Error(
      `Failed to parse Judge JSON from Vertex AI response. Raw Response: ${rawResponse.substring(0, 500)}...`,
    );
  }

  const result = JudgeV46Schema.safeParse(parsed);
  if (!result.success) {
    logger.error({
      msg: '[v4.6] Judge validation failed:',
      data: JSON.stringify(result.error.format(), null, 2),
    });
    logger.error({ msg: '[v4.6] Judge Raw Invalid JSON:', err: jsonStr });
    throw new Error(
      `Judge validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return { judgeJson: result.data as JudgeV46, raw: jsonStr };
}

// ─── Stage E: Regen Flagged Questions ────────────

export async function regenFlaggedV46(
  articleMarkdown: string,
  articleMetaJson: string,
  quizJson: string,
  judgeJson: string,
  quizDifficulty: QuizDifficulty,
): Promise<QuizQuestionV46[]> {
  const prompt = buildPromptE_v46(
    articleMarkdown,
    articleMetaJson,
    quizJson,
    judgeJson,
    quizDifficulty,
  );

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.5,
      maxOutputTokens: 8192,
      telemetry: { stage: 'regen' },
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Question Regen:', err: error });
    throw new Error(`Vertex AI API Error (Regen): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error({
      msg: '[v4.6] Failed to parse JSON from Vertex AI (Regen). Raw Response:',
      err: rawResponse,
    });
    throw new Error(
      `Failed to parse Regen JSON from Vertex AI response. Raw Response: ${rawResponse.substring(0, 500)}...`,
    );
  }

  const result = RegenV46Schema.safeParse(parsed);
  if (!result.success) {
    logger.error({
      msg: '[v4.6] Regen validation failed:',
      data: JSON.stringify(result.error.format(), null, 2),
    });
    logger.error({ msg: '[v4.6] Regen Raw Invalid JSON:', err: jsonStr });
    throw new Error(
      `Regen validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return result.data.questions as QuizQuestionV46[];
}

/**
 * Patch quiz: replace flagged questions with regenerated ones.
 */
export function patchQuiz(original: QuizV46, regenQuestions: QuizQuestionV46[]): QuizV46 {
  const regenMap = new Map(regenQuestions.map((q) => [q.id, q]));
  const patchedQuestions = original.questions.map((q) => regenMap.get(q.id) || q);
  return {
    ...original,
    questions: patchedQuestions,
  };
}

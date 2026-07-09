'use server';
import { logger } from '@/lib/logger';

import { after } from 'next/server';
import { callVertexAI, truncateToContext } from '@/lib/ai-client';
import { retrieveRelevantChunks } from '@/lib/rag';
import { JobStatus } from '@/types/job';
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
import { extractTextFromFile } from '@/lib/file-parser';
import { scanText } from '@/lib/documents/phiScanner';
import { MAX_DOCUMENT_UPLOAD_BYTES } from '@/lib/documents/upload-config';
import { checkRateLimit } from '@/lib/rate-limit';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { JobResponse } from '@/types/job';
import { Prisma } from '@/generated/prisma/client';

// Token budget for source content
const MAX_SOURCE_TOKENS = 100000;
const MAX_REGEN_CYCLES = 1;

// ─── Custom error for non-retryable source issues ──

class InsufficientSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientSourceError';
  }
}

// ─── Generation timeout + user-safe messaging (THER-002, THER-013) ──

// Wall-clock bound for the whole v4.6 pipeline. A hung stage (e.g. a stuck
// Vertex AI call) must never leave a Job in `processing` forever. Overridable
// via env so ops can tune it without a redeploy; falls back to 10 minutes.
const DEFAULT_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

function getGenerationTimeoutMs(): number {
  const parsed = Number(process.env.V46_GENERATION_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GENERATION_TIMEOUT_MS;
}

// Extra grace beyond the wall-clock timeout before the poll endpoint treats a
// still-`processing` Job as stale/orphaned (e.g. after a server restart that
// killed the background worker mid-run).
const STALE_JOB_GRACE_MS = 60 * 1000;

// Single user-facing failure message. Raw internal error detail (RAG context,
// stack traces, validation dumps) is logged server-side only and NEVER returned
// to the client — it previously leaked backend internals straight into the UI.
const GENERATION_FAILED_USER_MESSAGE =
  "We couldn't generate a course from this document — it may be too short or lack detail. Please try a more detailed document, or try again.";

// Thrown when the pipeline exceeds the wall-clock timeout.
class GenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Generation exceeded ${timeoutMs}ms wall-clock timeout`);
    this.name = 'GenerationTimeoutError';
  }
}

/**
 * Marks a Job as failed, storing the raw detail in the payload for server-side
 * debugging. The raw detail is sanitised at the API boundary
 * (checkCourseGenerationJobV46) before it can ever reach the client.
 */
async function markJobFailedV46(jobId: string, rawDetail: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      payload: { error: rawDetail } as unknown as Prisma.InputJsonValue,
    },
  });
}

// ─── Types ───────────────────────────────────────

interface CourseDataV46 {
  title: string;
  category: string;
  description: string;
  duration: string;
  notesCount: string;
  objectives: string[];
  quizTitle: string;
  quizQuestionCount: string;
  quizDifficulty: string;
  quizPassMark: string;
  quizAttempts: string;
}

export interface GeneratedCourseV46 {
  articleMeta: ArticleMetaV46 | null;
  articleMarkdown: string;
  slidesJson: SlidesV46 | null;
  quizJson: QuizV46 | null;
  judgeJson: JudgeV46 | null;
  sourceText?: string;
  error?: string;
}

// ─── JSON extraction helper ──────────────────────

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

async function generateSlidesV46(
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

async function generateQuizV46(
  articleMarkdown: string,
  articleMetaJson: string,
  requestedQuestionCount: number,
  quizDifficulty: QuizDifficulty,
  ragContext: string = '',
): Promise<{ quizJson: QuizV46; raw: string }> {
  const prompt = buildPromptC_v46(
    articleMarkdown,
    articleMetaJson,
    requestedQuestionCount,
    quizDifficulty,
    ragContext,
  );

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.5,
      maxOutputTokens: 16384,
    });
  } catch (error) {
    logger.error({ msg: '[v4.6] Vertex AI Call Failed during Quiz Generation:', err: error });
    throw new Error(`Vertex AI API Error (Quiz): ${(error as Error).message}`);
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
    throw new Error(
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
    throw new Error(
      `Quiz validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return { quizJson: result.data as QuizV46, raw: jsonStr };
}

// ─── Stage D: Judge ──────────────────────────────

async function judgeQuizV46(
  quizJson: string,
  articleMetaJson: string,
): Promise<{ judgeJson: JudgeV46; raw: string }> {
  const prompt = buildPromptD_v46(quizJson, articleMetaJson);

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.2,
      maxOutputTokens: 8192,
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

async function regenFlaggedV46(
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
function patchQuiz(original: QuizV46, regenQuestions: QuizQuestionV46[]): QuizV46 {
  const regenMap = new Map(regenQuestions.map((q) => [q.id, q]));
  const patchedQuestions = original.questions.map((q) => regenMap.get(q.id) || q);
  return {
    ...original,
    questions: patchedQuestions,
  };
}

// ─── Orchestrator ────────────────────────────────

export async function generateCourseAndQuizV46(
  formData: FormData,
): Promise<{ jobId?: string; error?: string }> {
  const rawData = formData.get('data');
  if (!rawData || typeof rawData !== 'string') {
    return { error: 'Missing course data' };
  }

  JSON.parse(rawData); // Validate format early
  const file = formData.get('file') as File | null;
  const documentId = formData.get('documentId') as string | null;

  let sourceText = '';
  let docFilename = 'User-provided document';

  if (file) {
    // F-017: reject oversized uploads BEFORE buffering/parsing the whole file.
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      const maxMb = Math.round(MAX_DOCUMENT_UPLOAD_BYTES / (1024 * 1024));
      logger.warn({ msg: '[v4.6] Upload rejected — file too large', size: file.size });
      return { error: `File is too large. The maximum document size is ${maxMb} MB.` };
    }
    try {
      logger.info({ msg: `[v4.6] Processing file: ${file.name} (${file.type})` });
      docFilename = file.name;
      sourceText = await extractTextFromFile(file);
      logger.info({ msg: `[v4.6] Extracted ${sourceText.length} characters from file.` });
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({ msg: '[v4.6] File parsing error:', err: error });
      return { error: `Failed to read document: ${error.message}` };
    }
  } else if (documentId) {
    // F-002: No PHI scan here — a stored document was already scanned and gated
    // at upload time in the Document Hub (see uploadDocument), so re-scanning
    // would be redundant. Only the fresh-upload path below needs a scan.
    try {
      const session = await auth();
      if (!session?.user?.id) {
        return { error: 'Unauthorized' };
      }

      const doc = await prisma.document.findUnique({
        where: { id: documentId, userId: session.user.id },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });

      if (!doc) {
        return { error: 'Document not found' };
      }

      docFilename = doc.filename;
      const latestVersion = doc.versions[0];
      sourceText = latestVersion?.content || '';

      if (!sourceText || sourceText.length < 50) {
        return { error: 'Document content is empty or too short to generate a course.' };
      }

      logger.info({
        msg: `[v4.6] Read ${sourceText.length} characters from stored document: ${docFilename}`,
      });
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({ msg: '[v4.6] DB document read error:', err: error });
      return { error: `Failed to read stored document: ${error.message}` };
    }
  } else {
    return { error: 'No document provided. Please select or upload a document.' };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Unauthorized' };
  }

  const userId = session.user.id;

  // F-018: rate-limit the expensive AI generation pipeline per user (10 / 10 min).
  const rate = await checkRateLimit(`ai-generate:${userId}`, 10, 600);
  if (!rate.allowed) {
    logger.warn({ msg: '[v4.6] Course generation rate limit exceeded', userId });
    return {
      error: `Too many generation requests. Please wait ${rate.resetInSeconds} seconds and try again.`,
    };
  }

  // F-002: PHI gate for the course-wizard UPLOAD path. Freshly-uploaded file
  // bytes have not been scanned yet (unlike the documentId path above), so we
  // scan here and block on PHI or scan-failure — mirroring the Document-Hub
  // gate in uploadDocument. This runs BEFORE any Job is created or scheduled.
  if (file) {
    let phiResult;
    try {
      phiResult = await scanText(sourceText);
    } catch (err) {
      logger.error({ msg: '[v4.6] PHI scan error on upload path', err, userId });
      return { error: 'We could not verify this document for PHI. Please try again in a moment.' };
    }

    if (phiResult.scanFailed) {
      logger.warn({ msg: '[v4.6] Upload blocked — PHI scan could not complete', userId });
      return { error: 'We could not verify this document for PHI. Please try again in a moment.' };
    }

    if (phiResult.hasPHI) {
      logger.warn({ msg: '[v4.6] Upload blocked — PHI detected', userId });
      return {
        error: 'This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be uploaded.',
      };
    }
  }

  const job = await prisma.job.create({
    data: {
      type: 'GENERATE_V46_COURSE',
      status: 'processing',
      userId: session.user.id,
    },
  });

  // Use after() to ensure background processing survives the server action's
  // request lifecycle. A bare fire-and-forget promise can be terminated when
  // Next.js cleans up the request context after the action returns.
  const jobId = job.id;
  after(async () => {
    try {
      await processBackgroundV46(jobId, sourceText, docFilename, rawData);
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({
        msg: `[v4.6] Background job ${jobId} failed in after():`,
        err: error.message,
      });
      // Attempt to mark the job as failed so the UI doesn't poll forever
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            payload: {
              error: error.message || 'Unknown error in after()',
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (updateErr) {
        logger.error({
          msg: `[v4.6] CRITICAL: Failed to mark job ${jobId} as failed:`,
          err: updateErr,
        });
      }
    }
  });

  logger.info({
    msg: `[v4.6] Returning jobId ${jobId} to client. Background work scheduled via after().`,
  });
  return { jobId };
}

async function processBackgroundV46(
  jobId: string,
  sourceText: string,
  docFilename: string,
  rawData: string,
) {
  const timeoutMs = getGenerationTimeoutMs();

  // Guards the terminal status write: whichever finishes first — the pipeline
  // or the wall-clock timeout — settles the Job; the loser becomes a no-op.
  // This stops a timed-out job from later flipping back to `completed`.
  let settled = false;
  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    return true;
  };

  // Wall-clock timeout: rejects the race even if a stage is mid-await, so a
  // stuck pipeline still marks the Job failed instead of hanging forever.
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new GenerationTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    await Promise.race([
      runPipelineV46(jobId, sourceText, docFilename, rawData, settle),
      timeoutPromise,
    ]);
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ msg: `[v4.6 Background] Job ${jobId} aborted:`, err: error.message });
    // Only write failed if the pipeline hasn't already settled the Job.
    if (settle()) {
      try {
        await markJobFailedV46(
          jobId,
          error.message || 'Unknown server error during background processing',
        );
      } catch (updateErr) {
        logger.error({
          msg: `[v4.6 Background] CRITICAL: Failed to mark job ${jobId} as failed:`,
          err: updateErr,
        });
      }
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function runPipelineV46(
  jobId: string,
  sourceText: string,
  docFilename: string,
  rawData: string,
  settle: () => boolean,
) {
  logger.info({
    msg: `[v4.6 Background] runPipelineV46 ENTERED for job ${jobId}. sourceText length: ${sourceText.length}, docFilename: ${docFilename}`,
  });
  try {
    const data: CourseDataV46 = JSON.parse(rawData);
    logger.info({
      msg: `[v4.6 Background] Parsed course data for job ${jobId}. Title: ${data.title}`,
    });
    const maxAttempts = 3;

    // ── Pre-Stage: Retrieve RAG Context ──
    let ragContext = '';
    try {
      if (data.category) {
        const categoryObj = await prisma.courseCategory.findUnique({
          where: { id: data.category },
          select: { name: true },
        });
        const categoryName = categoryObj?.name || '';

        logger.info({
          msg: `[v4.6 Background] Retrieving RAG chunks for category ${data.category} (${categoryName})`,
        });

        // Build a strong semantic query combining the category, title, and description
        const semanticQuery = [
          categoryName ? `Category: ${categoryName}` : '',
          data.title ? `Course Title: ${data.title}` : '',
          data.description ? `Course Description: ${data.description}` : '',
        ]
          .filter(Boolean)
          .join('. ');

        // Fallback to the beginning of the source text if metadata is completely empty
        const finalQuery = semanticQuery || sourceText.slice(0, 1000);

        const chunks = await retrieveRelevantChunks(finalQuery, data.category, 5);
        ragContext = chunks.map((c) => `[From Standard Manual]:\n${c.content}`).join('\n\n');
        logger.info({
          msg: `[v4.6 Background] Retrieved ${chunks.length} RAG chunks using query: "${finalQuery}"`,
        });
      }
    } catch (ragErr) {
      logger.error({ msg: `[v4.6 Background] RAG retrieval failed:`, err: ragErr });
      // Proceed without RAG if it fails
    }

    // ── Stage A: Generate Article + ArticleMeta ──

    let articleMeta: ArticleMetaV46 | null = null;
    let articleMarkdown = '';
    let rawArticleMetaJson = '';
    let errorMsg = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({
          msg: `[v4.6 Background] Stage A attempt ${attempt}/${maxAttempts} for job ${jobId}`,
        });
        const result = await generateArticleV46(sourceText, ragContext);
        articleMeta = result.articleMeta;
        articleMarkdown = result.articleMarkdown;
        rawArticleMetaJson = result.rawArticleMetaJson;

        if (articleMeta.meta.status === 'needs_sources') {
          errorMsg = `Insufficient source material: ${articleMeta.meta.gaps.join('; ')}`;
          logger.warn({
            msg: `[v4.6 Background] Stage A: needs_sources detected, skipping retries for job ${jobId}`,
          });
          break;
        }
        break;
      } catch (error: unknown) {
        const err = error as Error;
        // Don't retry insufficient source errors — the source text won't change
        if (err instanceof InsufficientSourceError) {
          errorMsg = err.message;
          logger.warn({
            msg: `[v4.6 Background] Stage A: insufficient source, not retrying for job ${jobId}`,
            err: err.message,
          });
          break;
        }
        logger.error({
          msg: `[v4.6 Background] Stage A attempt ${attempt} failed:`,
          err: err.message,
        });
        if (attempt === maxAttempts) errorMsg = err.message;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    if (!articleMeta || !articleMarkdown || articleMeta.meta.status === 'needs_sources') {
      // Store the raw Stage A detail for server-side debugging only; it is
      // sanitised at the API boundary before reaching the client.
      if (settle()) {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'failed', payload: { error: `Stage A failed: ${errorMsg}` } },
        });
      }
      return;
    }

    // ── Stage B + C: Slides + Quiz (parallel) ──

    const desiredSlideCount = parseInt(data.notesCount) || 10;
    const questionCount = parseInt(data.quizQuestionCount) || 10;
    const difficulty = (
      ['easy', 'medium', 'hard'].includes(data.quizDifficulty) ? data.quizDifficulty : 'medium'
    ) as QuizDifficulty;

    let slidesJson: SlidesV46 | null = null;
    let quizJson: QuizV46 | null = null;
    let rawQuizJson = '';

    // Run B and C sequentially to reduce peak API concurrency
    // Stage B: Slides
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({
          msg: `[v4.6 Background] Stage B attempt ${attempt}/${maxAttempts} for job ${jobId}`,
        });
        const slidesResult = await generateSlidesV46(
          articleMarkdown,
          rawArticleMetaJson,
          desiredSlideCount,
        );
        slidesJson = slidesResult.slidesJson;
        break;
      } catch (error: unknown) {
        const err = error as Error;
        logger.error({
          msg: `[v4.6 Background] Stage B attempt ${attempt} failed:`,
          err: err.message,
        });
        if (attempt === maxAttempts) {
          logger.error({ msg: '[v4.6 Background] Stage B (Slides) failed completely' });
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    // Stage C: Quiz
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({
          msg: `[v4.6 Background] Stage C attempt ${attempt}/${maxAttempts} for job ${jobId}`,
        });
        const quizResult = await generateQuizV46(
          articleMarkdown,
          rawArticleMetaJson,
          questionCount,
          difficulty,
          sourceText,
        );
        quizJson = quizResult.quizJson;
        rawQuizJson = quizResult.raw;
        break;
      } catch (error: unknown) {
        const err = error as Error;
        logger.error({
          msg: `[v4.6 Background] Stage C attempt ${attempt} failed:`,
          err: err.message,
        });
        if (attempt === maxAttempts) {
          logger.error({ msg: '[v4.6 Background] Stage C (Quiz) failed completely' });
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    // ── Stage D + E: Judge + Regen (only if quiz succeeded) ──

    let judgeJson: JudgeV46 | null = null;
    let rawJudgeJson = '';

    if (quizJson) {
      // Stage D: Judge
      try {
        logger.info({ msg: `[v4.6 Background] Stage D (Judge) for job ${jobId}` });
        const judgeResult = await judgeQuizV46(rawQuizJson, rawArticleMetaJson);
        judgeJson = judgeResult.judgeJson;
        rawJudgeJson = judgeResult.raw;

        // Stage E: Regen (if judge flagged questions)
        const flaggedCount = (judgeJson.ambiguous?.length || 0) + (judgeJson.invalid?.length || 0);
        if (flaggedCount > 0 && MAX_REGEN_CYCLES > 0) {
          logger.info({
            msg: `[v4.6 Background] Stage E: ${flaggedCount} flagged questions → regenerating for job ${jobId}`,
          });
          try {
            const regenQuestions = await regenFlaggedV46(
              articleMarkdown,
              rawArticleMetaJson,
              rawQuizJson,
              rawJudgeJson,
              difficulty,
            );
            quizJson = patchQuiz(quizJson, regenQuestions);
            logger.info({
              msg: `[v4.6 Background] Stage E: patched ${regenQuestions.length} questions for job ${jobId}`,
            });
          } catch (regenErr: unknown) {
            const err = regenErr as Error;
            logger.error({
              msg: `[v4.6 Background] Stage E failed (non-fatal):`,
              err: err.message,
            });
            // Non-fatal — keep original quiz
          }
        } else {
          logger.info({ msg: `[v4.6 Background] Stage D: no flagged questions for job ${jobId}` });
        }
      } catch (judgeErr: unknown) {
        const err = judgeErr as Error;
        logger.error({ msg: `[v4.6 Background] Stage D failed (non-fatal):`, err: err.message });
        // Non-fatal — keep quiz without judge review
      }
    }

    logger.info({
      msg: `[v4.6 Background] Pipeline complete for job ${jobId}. Sections: ${articleMeta.sections.length}, Slides: ${slidesJson?.slides.length || 0}, Questions: ${quizJson?.questions.length || 0}`,
    });

    const warnings: string[] = [];
    if (!slidesJson) warnings.push('Slides generation failed');
    if (!quizJson) warnings.push('Quiz generation failed');

    const resultPayload: GeneratedCourseV46 = {
      articleMeta,
      articleMarkdown,
      slidesJson,
      quizJson,
      judgeJson,
      sourceText,
      error: warnings.length > 0 ? warnings.join('; ') : undefined,
    };

    logger.info({ msg: `[v4.6 Background] About to mark job ${jobId} as COMPLETED.` });
    // Skip the completed write if the wall-clock timeout already settled the Job.
    if (settle()) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'completed', result: resultPayload as unknown as Prisma.InputJsonValue }, // Cast to unknown before InputJsonValue for Prisma Json
      });
      logger.info({ msg: `[v4.6 Background] Job ${jobId} marked as COMPLETED successfully.` });
    } else {
      logger.warn({
        msg: `[v4.6 Background] Job ${jobId} already settled (timed out) — discarding completed result.`,
      });
    }
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ msg: `[v4.6 Background] Uncaught fatal error in job ${jobId}:`, err: error });
    // Skip if the wall-clock timeout already settled the Job.
    if (settle()) {
      try {
        await markJobFailedV46(
          jobId,
          error.message || 'Unknown server error during background processing',
        );
        logger.error({ msg: `[v4.6 Background] Job ${jobId} marked as FAILED.` });
      } catch (updateErr) {
        logger.error({
          msg: `[v4.6 Background] CRITICAL: Failed to update job ${jobId} status to failed:`,
          err: updateErr,
        });
      }
    }
  }
  logger.info({ msg: `[v4.6 Background] runPipelineV46 EXITED for job ${jobId}.` });
}

export async function checkCourseGenerationJobV46(
  jobId: string,
): Promise<JobResponse<GeneratedCourseV46>> {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      logger.info({ msg: `[v4.6 checkJob] Job ${jobId} NOT FOUND in database.` });
      return { error: 'Job not found' };
    }

    logger.info({ msg: `[v4.6 checkJob] Job ${jobId} status: ${job.status}` });

    // Stale-job reconciler: a Job stuck in `processing` well past the wall-clock
    // timeout (e.g. the background worker died before it could self-fail) is
    // treated as failed so the client stops polling forever (THER-002).
    if (job.status === 'processing') {
      const staleAfterMs = getGenerationTimeoutMs() + STALE_JOB_GRACE_MS;
      const ageMs = Date.now() - new Date(job.updatedAt).getTime();
      if (ageMs > staleAfterMs) {
        logger.warn({
          msg: `[v4.6 checkJob] Job ${jobId} stale (age ${ageMs}ms > ${staleAfterMs}ms) — reconciling to failed`,
        });
        // Best-effort write-back so the record reflects reality for all readers.
        // Scoped to `processing` so we never clobber a concurrently-settled Job.
        try {
          await prisma.job.updateMany({
            where: { id: jobId, status: 'processing' },
            data: {
              status: 'failed',
              payload: {
                error: 'Generation timed out (stale job reconciled)',
              } as unknown as Prisma.InputJsonValue,
            },
          });
        } catch (reconErr) {
          logger.error({
            msg: `[v4.6 checkJob] Failed to reconcile stale job ${jobId}:`,
            err: reconErr,
          });
        }
        return { status: 'failed', error: GENERATION_FAILED_USER_MESSAGE };
      }
    }

    if (job.status === 'completed') {
      return { status: 'completed', result: job.result as unknown as GeneratedCourseV46 };
    } else if (job.status === 'failed') {
      // Log the raw internal detail for debugging; return ONLY a safe, generic
      // message to the client so backend internals never leak into the UI.
      const payload = job.payload as Record<string, unknown>;
      const rawDetail = (payload?.error as string) || 'Generation failed';
      logger.error({ msg: `[v4.6 checkJob] Job ${jobId} failed`, err: rawDetail });
      return { status: 'failed', error: GENERATION_FAILED_USER_MESSAGE };
    }

    return { status: job.status as JobStatus };
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ msg: `[v4.6 checkJob] Error checking job ${jobId}:`, err: error.message });
    return { error: `Failed to check job: ${error.message}` };
  }
}

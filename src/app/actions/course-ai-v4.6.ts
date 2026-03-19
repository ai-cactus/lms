'use server';

import { callVertexAI, truncateToContext } from '@/lib/ai-client';
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
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { JobResponse } from '@/types/job';

// Token budget for source content
const MAX_SOURCE_TOKENS = 100000;
const MAX_REGEN_CYCLES = 1;

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

  // Find the first ```json fence and its closing ```
  const jsonFenceStart = text.search(/```json\s/);
  if (jsonFenceStart === -1) {
    // Fallback: try to find any JSON block
    const jsonStr = extractJsonFromResponse(text);
    return { jsonStr, markdown: '' };
  }

  // Find the content start (after ```json\n)
  const contentStart = text.indexOf('\n', jsonFenceStart) + 1;

  // Find the closing ``` for this fence
  // We need to find the FIRST ``` after contentStart that closes this fence
  const closingFence = text.indexOf('\n```', contentStart);
  if (closingFence === -1) {
    throw new Error('Could not find closing fence for articleMeta JSON block');
  }

  const jsonStr = text.substring(contentStart, closingFence).trim();

  // Everything after the closing fence is Markdown
  const afterFence = closingFence + 4; // skip \n```
  let markdown = text.substring(afterFence).trim();

  // Strip any leading/trailing markdown fences from the article itself
  if (markdown.startsWith('```markdown')) {
    markdown = markdown
      .replace(/^```markdown\s*/, '')
      .replace(/```\s*$/, '')
      .trim();
  }

  return { jsonStr, markdown };
}

// ─── Stage A: Article + ArticleMeta Generation ──

export async function generateArticleV46(
  sourceText: string,
  metadataJson?: string,
): Promise<{ articleMeta: ArticleMetaV46; articleMarkdown: string; rawArticleMetaJson: string }> {
  const prompt = buildPromptA_v46(sourceText, metadataJson);

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.4,
      maxOutputTokens: 16384,
    });
  } catch (error) {
    console.error('[v4.6] Vertex AI Call Failed during Article Generation:', error);
    throw new Error(`Vertex AI API Error (Article): ${(error as Error).message}`);
  }

  const { jsonStr, markdown } = parseDualOutput(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    console.error(
      '[v4.6] Failed to parse JSON from Vertex AI (ArticleMeta). Raw Response:',
      rawResponse,
    );
    throw new Error('Failed to parse ArticleMeta JSON from Vertex AI response.');
  }

  const result = ArticleMetaV46Schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[v4.6] ArticleMeta validation failed:',
      JSON.stringify(result.error.format(), null, 2),
    );
    console.error('[v4.6] ArticleMeta Raw Invalid JSON:', jsonStr);
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
    console.error('[v4.6] Vertex AI Call Failed during Slides Generation:', error);
    throw new Error(`Vertex AI API Error (Slides): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    console.error(
      '[v4.6] Failed to parse JSON from Vertex AI (Slides). Raw Response:',
      rawResponse,
    );
    throw new Error('Failed to parse Slides JSON from Vertex AI response.');
  }

  const result = SlidesV46Schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[v4.6] Slides validation failed:',
      JSON.stringify(result.error.format(), null, 2),
    );
    console.error('[v4.6] Slides Raw Invalid JSON:', jsonStr);
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
): Promise<{ quizJson: QuizV46; raw: string }> {
  const prompt = buildPromptC_v46(
    articleMarkdown,
    articleMetaJson,
    requestedQuestionCount,
    quizDifficulty,
  );

  let rawResponse = '';
  try {
    rawResponse = await callVertexAI(prompt, {
      temperature: 0.5,
      maxOutputTokens: 16384,
    });
  } catch (error) {
    console.error('[v4.6] Vertex AI Call Failed during Quiz Generation:', error);
    throw new Error(`Vertex AI API Error (Quiz): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    console.error('[v4.6] Failed to parse JSON from Vertex AI (Quiz). Raw Response:', rawResponse);
    throw new Error('Failed to parse Quiz JSON from Vertex AI response.');
  }

  const result = QuizV46Schema.safeParse(parsed);
  if (!result.success) {
    console.error('[v4.6] Quiz validation failed:', JSON.stringify(result.error.format(), null, 2));
    console.error('[v4.6] Quiz Raw Invalid JSON:', jsonStr);
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
    console.error('[v4.6] Vertex AI Call Failed during Judge Generation:', error);
    throw new Error(`Vertex AI API Error (Judge): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    console.error('[v4.6] Failed to parse JSON from Vertex AI (Judge). Raw Response:', rawResponse);
    throw new Error('Failed to parse Judge JSON from Vertex AI response.');
  }

  const result = JudgeV46Schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[v4.6] Judge validation failed:',
      JSON.stringify(result.error.format(), null, 2),
    );
    console.error('[v4.6] Judge Raw Invalid JSON:', jsonStr);
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
    console.error('[v4.6] Vertex AI Call Failed during Question Regen:', error);
    throw new Error(`Vertex AI API Error (Regen): ${(error as Error).message}`);
  }

  const jsonStr = extractJsonFromResponse(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    console.error('[v4.6] Failed to parse JSON from Vertex AI (Regen). Raw Response:', rawResponse);
    throw new Error('Failed to parse Regen JSON from Vertex AI response.');
  }

  const result = RegenV46Schema.safeParse(parsed);
  if (!result.success) {
    console.error(
      '[v4.6] Regen validation failed:',
      JSON.stringify(result.error.format(), null, 2),
    );
    console.error('[v4.6] Regen Raw Invalid JSON:', jsonStr);
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
    try {
      console.log(`[v4.6] Processing file: ${file.name} (${file.type})`);
      docFilename = file.name;
      sourceText = await extractTextFromFile(file);
      console.log(`[v4.6] Extracted ${sourceText.length} characters from file.`);
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[v4.6] File parsing error:', error);
      return { error: `Failed to read document: ${error.message}` };
    }
  } else if (documentId) {
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

      console.log(
        `[v4.6] Read ${sourceText.length} characters from stored document: ${docFilename}`,
      );
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[v4.6] DB document read error:', error);
      return { error: `Failed to read stored document: ${error.message}` };
    }
  } else {
    return { error: 'No document provided. Please select or upload a document.' };
  }

  const session = await auth();

  const job = await prisma.job.create({
    data: {
      type: 'GENERATE_V46_COURSE',
      status: 'processing',
      userId: session?.user?.id,
    },
  });

  // Start background processing, DO NOT AWAIT
  processBackgroundV46(job.id, sourceText, docFilename, rawData).catch((err: unknown) => {
    const error = err as Error;
    console.error('[v4.6] Background job failed fatally:', error.message);
  });

  return { jobId: job.id };
}

async function processBackgroundV46(
  jobId: string,
  sourceText: string,
  docFilename: string,
  rawData: string,
) {
  try {
    const data: CourseDataV46 = JSON.parse(rawData);
    const maxAttempts = 3;

    // ── Stage A: Generate Article + ArticleMeta ──

    let articleMeta: ArticleMetaV46 | null = null;
    let articleMarkdown = '';
    let rawArticleMetaJson = '';
    let errorMsg = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[v4.6 Background] Stage A attempt ${attempt}/${maxAttempts} for job ${jobId}`);
        const result = await generateArticleV46(sourceText);
        articleMeta = result.articleMeta;
        articleMarkdown = result.articleMarkdown;
        rawArticleMetaJson = result.rawArticleMetaJson;

        if (articleMeta.meta.status === 'needs_sources') {
          throw new Error(`Insufficient source material: ${articleMeta.meta.gaps.join('; ')}`);
        }
        break;
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[v4.6 Background] Stage A attempt ${attempt} failed:`, err.message);
        if (attempt === maxAttempts) errorMsg = err.message;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    if (!articleMeta || !articleMarkdown) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', payload: { error: `Stage A failed: ${errorMsg}` } },
      });
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

    // Run B and C in parallel
    const [slidesResult, quizResult] = await Promise.allSettled([
      // Stage B: Slides
      (async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(
              `[v4.6 Background] Stage B attempt ${attempt}/${maxAttempts} for job ${jobId}`,
            );
            return await generateSlidesV46(articleMarkdown, rawArticleMetaJson, desiredSlideCount);
          } catch (error: unknown) {
            const err = error as Error;
            console.error(`[v4.6 Background] Stage B attempt ${attempt} failed:`, err.message);
            if (attempt === maxAttempts) throw err;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      })(),
      // Stage C: Quiz
      (async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            console.log(
              `[v4.6 Background] Stage C attempt ${attempt}/${maxAttempts} for job ${jobId}`,
            );
            return await generateQuizV46(
              articleMarkdown,
              rawArticleMetaJson,
              questionCount,
              difficulty,
            );
          } catch (error: unknown) {
            const err = error as Error;
            console.error(`[v4.6 Background] Stage C attempt ${attempt} failed:`, err.message);
            if (attempt === maxAttempts) throw err;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      })(),
    ]);

    if (slidesResult.status === 'fulfilled' && slidesResult.value) {
      slidesJson = slidesResult.value.slidesJson;
    } else {
      console.error('[v4.6 Background] Stage B (Slides) failed completely');
    }

    if (quizResult.status === 'fulfilled' && quizResult.value) {
      quizJson = quizResult.value.quizJson;
      rawQuizJson = quizResult.value.raw;
    } else {
      console.error('[v4.6 Background] Stage C (Quiz) failed completely');
    }

    // ── Stage D + E: Judge + Regen (only if quiz succeeded) ──

    let judgeJson: JudgeV46 | null = null;
    let rawJudgeJson = '';

    if (quizJson) {
      // Stage D: Judge
      try {
        console.log(`[v4.6 Background] Stage D (Judge) for job ${jobId}`);
        const judgeResult = await judgeQuizV46(rawQuizJson, rawArticleMetaJson);
        judgeJson = judgeResult.judgeJson;
        rawJudgeJson = judgeResult.raw;

        // Stage E: Regen (if judge flagged questions)
        const flaggedCount = (judgeJson.ambiguous?.length || 0) + (judgeJson.invalid?.length || 0);
        if (flaggedCount > 0 && MAX_REGEN_CYCLES > 0) {
          console.log(
            `[v4.6 Background] Stage E: ${flaggedCount} flagged questions → regenerating for job ${jobId}`,
          );
          try {
            const regenQuestions = await regenFlaggedV46(
              articleMarkdown,
              rawArticleMetaJson,
              rawQuizJson,
              rawJudgeJson,
              difficulty,
            );
            quizJson = patchQuiz(quizJson, regenQuestions);
            console.log(
              `[v4.6 Background] Stage E: patched ${regenQuestions.length} questions for job ${jobId}`,
            );
          } catch (regenErr: unknown) {
            const err = regenErr as Error;
            console.error(`[v4.6 Background] Stage E failed (non-fatal):`, err.message);
            // Non-fatal — keep original quiz
          }
        } else {
          console.log(`[v4.6 Background] Stage D: no flagged questions for job ${jobId}`);
        }
      } catch (judgeErr: unknown) {
        const err = judgeErr as Error;
        console.error(`[v4.6 Background] Stage D failed (non-fatal):`, err.message);
        // Non-fatal — keep quiz without judge review
      }
    }

    console.log(
      `[v4.6 Background] Pipeline complete for job ${jobId}. Sections: ${articleMeta.sections.length}, Slides: ${slidesJson?.slides.length || 0}, Questions: ${quizJson?.questions.length || 0}`,
    );

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

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'completed', result: resultPayload as unknown as Prisma.InputJsonValue }, // Cast to unknown before InputJsonValue for Prisma Json
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[v4.6 Background] Uncaught fatal error in job ${jobId}:`, error);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        payload: {
          error: error.message || 'Unknown server error during background processing',
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function checkCourseGenerationJobV46(
  jobId: string,
): Promise<JobResponse<GeneratedCourseV46>> {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return { error: 'Job not found' };

    if (job.status === 'completed') {
      return { status: 'completed', result: job.result as unknown as GeneratedCourseV46 };
    } else if (job.status === 'failed') {
      const payload = job.payload as Record<string, unknown>;
      return { status: 'failed', error: (payload?.error as string) || 'Generation failed' };
    }

    return { status: job.status as JobStatus };
  } catch (err: unknown) {
    const error = err as Error;
    return { error: `Failed to check job: ${error.message}` };
  }
}

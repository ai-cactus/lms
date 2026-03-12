'use server';

import { z } from 'zod';
import { extractTextFromFile } from '@/lib/file-parser';
import { callVertexAI, truncateToContext } from '@/lib/ai-client';
import { buildPromptA, buildPromptB } from '@/lib/prompts';
import { CourseV3Schema, QuizV3Schema } from '@/lib/prompt-schemas';
import type { CourseV3, QuizV3, QuizDifficulty } from '@/lib/prompt-types';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';

// Token budget for source content
const MAX_SOURCE_TOKENS = 100000;

// ─── Types ───────────────────────────────────────

interface CourseDataV3 {
  title: string;
  category: string;
  description: string;
  duration: string;
  notesCount: string;
  objectives: string[];
  // Quiz config
  quizTitle: string;
  quizQuestionCount: string;
  quizDifficulty: string;
  quizPassMark: string;
  quizAttempts: string;
}

export interface GeneratedCourseV3 {
  courseJson: CourseV3 | null;
  quizJson: QuizV3 | null;
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

// ─── Stage 1: Course Generation (Prompt A) ───────

async function generateCourseJsonV3(
  sourceText: string,
  documents: { docId: string; label: string; hint?: string }[],
  requestedSlideCount?: number,
): Promise<{ courseJson: CourseV3; raw: string }> {
  const prompt = buildPromptA({
    sourceTexts: sourceText,
    documents,
    requestedSlideCount,
  });

  const rawResponse = await callVertexAI(prompt, {
    temperature: 0.4,
    maxOutputTokens: 16384,
  });

  const jsonStr = extractJsonFromResponse(rawResponse);
  const parsed = JSON.parse(jsonStr);

  const result = CourseV3Schema.safeParse(parsed);
  if (!result.success) {
    console.error('[v3.1] Course JSON validation failed:', result.error.format());
    throw new Error(
      `Course JSON validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return { courseJson: result.data as CourseV3, raw: jsonStr };
}

// ─── Stage 2: Quiz Generation (Prompt B) ─────────

async function generateQuizJsonV3(
  courseJson: string,
  requestedQuestionCount: number,
  quizDifficulty: QuizDifficulty,
): Promise<{ quizJson: QuizV3; raw: string }> {
  const prompt = buildPromptB({
    courseJson,
    requestedQuestionCount,
    quizDifficulty,
  });

  const rawResponse = await callVertexAI(prompt, {
    temperature: 0.5,
    maxOutputTokens: 16384,
  });

  const jsonStr = extractJsonFromResponse(rawResponse);
  const parsed = JSON.parse(jsonStr);

  const result = QuizV3Schema.safeParse(parsed);
  if (!result.success) {
    console.error('[v3.1] Quiz JSON validation failed:', result.error.format());
    throw new Error(
      `Quiz JSON validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  return { quizJson: result.data as QuizV3, raw: jsonStr };
}

// ─── Orchestrator (Prompt A → Prompt B) ──────────

export async function generateCourseAndQuizV3(
  formData: FormData,
): Promise<{ jobId?: string; error?: string }> {
  // Extract data from FormData
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
    // Freshly uploaded file — read from blob
    try {
      console.log(`[v3.1] Processing file: ${file.name} (${file.type})`);
      docFilename = file.name;
      sourceText = await extractTextFromFile(file);
      console.log(`[v3.1] Extracted ${sourceText.length} characters from file.`);
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[v3.1] File parsing error:', error);
      return { error: `Failed to read document: ${error.message}` };
    }
  } else if (documentId) {
    // Pre-existing document — read stored content from DB
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
        `[v3.1] Read ${sourceText.length} characters from stored document: ${docFilename}`,
      );
      sourceText = truncateToContext(sourceText, MAX_SOURCE_TOKENS);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[v3.1] DB document read error:', error);
      return { error: `Failed to read stored document: ${error.message}` };
    }
  } else {
    return { error: 'No document provided. Please select or upload a document.' };
  }

  const session = await auth();

  // Create a job
  const job = await prisma.job.create({
    data: {
      type: 'GENERATE_V3_COURSE',
      status: 'processing',
      userId: session?.user?.id,
    },
  });

  // Start background processing immediately, DO NOT AWAIT IT
  processBackgroundV3(job.id, sourceText, docFilename, rawData).catch((err) => {
    console.error('[v3.1] Background job failed fatally:', err);
  });

  // Return job ID immediately to the client to avoid 524 Gateway Timeout
  return { jobId: job.id };
}

async function processBackgroundV3(
  jobId: string,
  sourceText: string,
  docFilename: string,
  rawData: string,
) {
  try {
    const data: CourseDataV3 = JSON.parse(rawData);
    const documents = [{ docId: 'doc-1', label: docFilename }];
    const maxAttempts = 3;

    // ── Stage 1: Generate Course JSON ──
    let courseJson: CourseV3 | null = null;
    let courseRaw = '';
    let errorMsg = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[v3.1 Background] Course generation attempt ${attempt}/${maxAttempts} for job ${jobId}`,
        );
        const result = await generateCourseJsonV3(
          sourceText,
          documents,
          parseInt(data.notesCount) || 10,
        );
        courseJson = result.courseJson;
        courseRaw = result.raw;

        if (courseJson.meta.status === 'needs_sources') {
          throw new Error(`Insufficient source material: ${courseJson.meta.gaps.join('; ')}`);
        }
        break;
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[v3.1 Background] Course attempt ${attempt} failed:`, err.message);
        if (attempt === maxAttempts) errorMsg = err.message;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    if (!courseJson) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', payload: { error: `Failed to generate course: ${errorMsg}` } },
      });
      return;
    }

    // ── Stage 2: Generate Quiz JSON ──
    const questionCount = Math.max(8, Math.min(30, parseInt(data.quizQuestionCount) || 10));
    const difficulty = (
      ['easy', 'medium', 'hard'].includes(data.quizDifficulty) ? data.quizDifficulty : 'medium'
    ) as QuizDifficulty;

    let quizJson: QuizV3 | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(
          `[v3.1 Background] Quiz generation attempt ${attempt}/${maxAttempts} for job ${jobId}`,
        );
        const result = await generateQuizJsonV3(courseRaw, questionCount, difficulty);
        quizJson = result.quizJson;
        break;
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[v3.1 Background] Quiz attempt ${attempt} failed:`, err.message);
        if (attempt === maxAttempts) errorMsg = err.message;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    console.log(
      `[v3.1 Background] Pipeline complete for job ${jobId}. Course modules: ${courseJson.modules.length}`,
    );

    const resultPayload = {
      courseJson,
      quizJson,
      sourceText,
      error: !quizJson ? `Course generated successfully, but quiz failed: ${errorMsg}` : undefined,
    };

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'completed', result: resultPayload as unknown as Prisma.InputJsonValue },
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[v3.1 Background] Uncaught fatal error in job ${jobId}:`, error);
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

export async function checkCourseGenerationJob(jobId: string) {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return { error: 'Job not found' };

    if (job.status === 'completed') {
      return { status: 'completed', result: job.result as unknown as GeneratedCourseV3 };
    } else if (job.status === 'failed') {
      const payload = job.payload as Record<string, unknown>;
      return { status: 'failed', error: (payload?.error as string) || 'Generation failed' };
    }

    return { status: job.status };
  } catch (err: unknown) {
    const error = err as Error;
    return { error: `Failed to check job: ${error.message}` };
  }
}

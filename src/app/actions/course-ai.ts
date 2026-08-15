'use server';

import { z } from 'zod';
import { callVertexAI, truncateToContext } from '@/lib/ai-client';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

// Token budget for quick metadata analysis (~50k chars)
const MAX_ANALYSIS_TOKENS = 12500;

const CourseMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  objectives: z.array(z.string()).min(3),
  duration: z.coerce.string().describe("Estimated duration in minutes, e.g. '60'"),
  quizTitle: z.string().describe('A catching title for the quiz'),
});

export type AnalyzedMetadata = z.infer<typeof CourseMetadataSchema> & { error?: string };

// Single user-facing failure message for document analysis. Raw internal error
// detail (Vertex AI errors, stack traces, validation dumps) is logged
// server-side only and NEVER returned to the client — it previously leaked
// backend internals (e.g. a raw "Vertex AI 404 Not Found: <!DOCTYPE html>...")
// straight into the course wizard UI. Mirrors the THER-013 boundary fix in
// course-ai-v4.6.ts.
const ANALYSIS_FAILED_USER_MESSAGE =
  "We couldn't analyze this document automatically. You can fill in the details manually or try again.";

/**
 * Analyze a previously-uploaded document stored in the database.
 * Used by CourseWizard for both a freshly-uploaded and a previously-selected
 * document — the wizard uploads first, then analyses the stored copy.
 *
 * ── PHI egress invariant (F-003) ────────────────────────────────────────────
 * This function sends document text to Vertex AI, so it MUST only ever receive
 * text that has already passed the fail-closed `scanText` gate. It reads
 * `DocumentVersion.content`, and the only production writer of that column is
 * uploadDocument() in documents.ts, which blocks on both `phiResult.hasPHI`
 * and `phiResult.scanFailed` *before* persisting. The gate is therefore
 * transitive rather than local — do not add a code path that feeds this
 * function text from anywhere else without scanning it first.
 *
 * A sibling `analyzeDocument(formData)` used to take a raw File and analyse it
 * directly. It was removed: as a `'use server'` action it was an independently
 * invokable endpoint with no auth check, no rate limit and no PHI gate, which
 * forwarded arbitrary uploaded text to Vertex and ran pdf-parse/mammoth on
 * attacker-controlled bytes with no size cap. The wizard already had the
 * stored document's id, so routing through this function closed the hole and
 * removed a duplicate text extraction.
 *
 * @deprecated Use course-ai-v4.6.ts instead. This is the original AI pipeline.
 */
export async function analyzeStoredDocument(documentId: string): Promise<AnalyzedMetadata> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationUserId)
    return {
      title: '',
      description: '',
      objectives: [],
      duration: '',
      quizTitle: '',
      error: 'Unauthorized',
    };

  // F-018: this is an AI-backed endpoint, so it carries the same per-user
  // quota as the other generation paths — an authenticated caller must not be
  // able to drive unbounded Vertex spend by replaying the action.
  const { allowed, resetInSeconds } = await checkRateLimit(
    `doc-analysis:${session.user.id}`,
    20,
    300,
  );
  if (!allowed) {
    logger.warn({ msg: '[course] Document analysis rate limit exceeded', userId: session.user.id });
    return {
      title: '',
      description: '',
      objectives: [],
      duration: '',
      quizTitle: '',
      error: `Too many analysis requests. Please wait ${resetInSeconds} seconds and try again.`,
    };
  }

  try {
    const doc = await prisma.document.findUnique({
      where: { id: documentId, organizationUserId: session.user.organizationUserId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    if (!doc)
      return {
        title: '',
        description: '',
        objectives: [],
        duration: '',
        quizTitle: '',
        error: 'Document not found',
      };

    const latestVersion = doc.versions[0];
    const sourceText = latestVersion?.content || '';
    const filename = doc.filename;

    logger.info({ msg: `Analyzing stored file: ${filename} (Length: ${sourceText.length})` });

    if (!sourceText || sourceText.length < 50) {
      logger.error({ msg: `Extraction failed/empty: Text length is ${sourceText?.length || 0}` });
      return {
        title: filename,
        description: 'Document content is empty or too short to analyze.',
        objectives: ['Review the document content manually.'],
        duration: '30',
        quizTitle: `Quiz: ${filename}`,
        error: 'Document content is empty or too short.',
      };
    }

    // Truncate for analysis speed & cost
    const truncatedText = truncateToContext(sourceText, MAX_ANALYSIS_TOKENS);

    const prompt = `
            You are an expert instructional designer. Analyze the following document text and extract key course metadata.
            
            DOCUMENT TEXT START:
            ${truncatedText}
            DOCUMENT TEXT END

            Output a valid JSON object with the following fields:
            - title: A professional, engaging title for a training course based on this content.
            - description: A concise (2-3 sentences) summary of what this course covers.
            - objectives: An array of 3-5 distinct learning objectives (start with action verbs).
            - duration: Estimated time in minutes to read/complete this content (just the number, e.g. "45").
            - quizTitle: A relevant title for the assessment quiz (e.g. "Knowledge Check: [Topic]").

            Return ONLY valid JSON.
        `;

    const textPart = await callVertexAI(prompt);
    let rawText = textPart;

    logger.info({ msg: 'Raw AI Response:', data: rawText });

    // Robust JSON extraction
    const firstOpenBrace = rawText.indexOf('{');
    const lastCloseBrace = rawText.lastIndexOf('}');

    if (firstOpenBrace !== -1 && lastCloseBrace !== -1 && lastCloseBrace > firstOpenBrace) {
      rawText = rawText.substring(firstOpenBrace, lastCloseBrace + 1);
    } else {
      logger.error({ msg: 'No JSON block found in response.' });
      throw new Error('AI response did not contain valid JSON.');
    }

    const parsedData = JSON.parse(rawText);
    const result = CourseMetadataSchema.safeParse(parsedData);

    if (result.success) {
      return result.data;
    } else {
      logger.error({ msg: 'Analysis Schema Validation Failed:', err: result.error });
      return {
        title: parsedData.title || filename.replace(/\.[^/.]+$/, ''),
        description: parsedData.description || 'Generated from uploaded document.',
        objectives: parsedData.objectives || ['Understand the document content.'],
        duration: parsedData.duration || '30',
        quizTitle: parsedData.quizTitle || `Quiz: ${filename.replace(/\.[^/.]+$/, '')}`,
      };
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ msg: 'Stored Document Analysis Error:', err: err });
    return {
      title: 'Course Title',
      description: 'Failed to analyze document automatically.',
      objectives: ['Review the document content.'],
      duration: '30',
      quizTitle: 'Quiz',
      error: ANALYSIS_FAILED_USER_MESSAGE,
    };
  }
}

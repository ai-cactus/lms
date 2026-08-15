/**
 * Guards the public action surface of course-ai-v4.6.ts (F-084).
 *
 * Every exported async function in a `'use server'` module becomes a Next.js
 * Server Action: a live HTTP endpoint whose action id ships in the client
 * bundle and can be POSTed directly, with no requirement to go through the UI.
 *
 * This module previously exported `generateArticleV46` and `generateQuizV46` —
 * internal pipeline stages that take caller-supplied text straight to Vertex AI
 * at maxOutputTokens 16384. Neither had an auth check (they run in background
 * stages where no session exists), a rate limit, or a PHI scan, which made them
 * an unauthenticated LLM proxy on the project's Vertex billing. One was exported
 * only so a test could import it.
 *
 * They now live in `src/lib/ai/course-pipeline-v46.ts`, a plain module. This
 * test pins the action surface to the two genuine entry points so that
 * re-exporting a stage — or adding a new one here for convenience — fails
 * loudly instead of quietly opening an endpoint.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/ai-client', () => ({
  truncateToContext: (t: string) => t,
  estimateTokens: (t: string) => t.length,
}));
vi.mock('@/lib/rag', () => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: vi.fn() }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

describe("course-ai-v4.6 'use server' surface", () => {
  /**
   * The only functions that should be reachable as actions:
   *   generateCourseAndQuizV46 — gates on scanText before creating a Job
   *   checkCourseGenerationJobV46 — job status polling
   *   startModuleGenerationJobs — 9-step wizard batch wrapper; every module is
   *     routed through generateCourseAndQuizV46, so auth, rate limiting, and
   *     the PHI scan all still apply per module
   */
  const ALLOWED_ACTIONS = [
    'checkCourseGenerationJobV46',
    'generateCourseAndQuizV46',
    'startModuleGenerationJobs',
  ];

  it('exports only the intended entry points as callable actions', async () => {
    const mod: Record<string, unknown> = await import('./course-ai-v4.6');

    const exportedFunctions = Object.keys(mod)
      .filter((key) => typeof mod[key] === 'function')
      .sort();

    expect(exportedFunctions).toEqual(ALLOWED_ACTIONS);
  });

  it('does not re-export any AI pipeline stage', async () => {
    const mod: Record<string, unknown> = await import('./course-ai-v4.6');

    for (const stage of [
      'generateArticleV46',
      'generateSlidesV46',
      'generateQuizChunkV46',
      'generateQuizV46',
      'judgeQuizV46',
      'regenFlaggedV46',
      'patchQuiz',
    ]) {
      expect(
        mod[stage],
        `${stage} must not be exported from a 'use server' module`,
      ).toBeUndefined();
    }
  });
});

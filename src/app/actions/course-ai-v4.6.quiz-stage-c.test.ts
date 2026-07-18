/**
 * Unit tests for Stage C quiz generation batch chunking (Phase 2 Issue #3 /
 * TC-013, TC-014) in course-ai-v4.6.ts.
 *
 * Root cause (per qa-reports/phase-2-fix-plan.md): the old fixed 16,384-token
 * output cap silently truncated large quiz batches (finishReason=MAX_TOKENS →
 * cut-off JSON → parse failure → 0 questions). The fix raises the per-call
 * ceiling AND splits any request over QUIZ_SINGLE_CALL_MAX (20) into
 * QUIZ_SUB_BATCH_SIZE (6)-question sub-batches, each independently retried,
 * then merged with de-dup + re-numbering. `generateQuizV46` was exported
 * (still async, so it stays valid in a 'use server' module) solely so this
 * orchestration is testable without driving the full background pipeline —
 * see the export-site comment in course-ai-v4.6.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallVertexAI } = vi.hoisted(() => ({ mockCallVertexAI: vi.fn() }));

vi.mock('@/lib/ai-client', () => ({
  callVertexAI: mockCallVertexAI,
  truncateToContext: (text: string) => text,
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
// generateQuizV46 doesn't touch these, but the module graph (course-ai-v4.6.ts)
// imports them at the top level, so they must resolve.
vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: vi.fn() }));
vi.mock('@/lib/rag', () => ({ retrieveRelevantChunks: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));

import { generateQuizV46 } from './course-ai-v4.6';

/** A minimal valid QuizV46 raw-JSON response for `count` questions. */
function makeQuizResponse(count: number, opts: { startId?: number; questionPrefix?: string } = {}) {
  const { startId = 1, questionPrefix = 'Question' } = opts;
  return JSON.stringify({
    meta: {
      promptVersion: 'v4.6-quiz',
      requestedQuestionCount: count,
      quizDifficulty: 'medium',
      totalQuestions: count,
    },
    questions: Array.from({ length: count }, (_, i) => ({
      id: `q${String(startId + i).padStart(2, '0')}`,
      question: `${questionPrefix} ${startId + i}?`,
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateQuizV46 — single-call path (count <= 20)', () => {
  it('makes exactly one Vertex AI call for a count at the threshold (20)', async () => {
    mockCallVertexAI.mockResolvedValue(makeQuizResponse(20));

    const { quizJson } = await generateQuizV46('article md', '{}', 20, 'medium');

    expect(mockCallVertexAI).toHaveBeenCalledTimes(1);
    expect(quizJson.questions).toHaveLength(20);
    expect(quizJson.meta.requestedQuestionCount).toBe(20);
  });

  it('makes exactly one Vertex AI call for a small count (5)', async () => {
    mockCallVertexAI.mockResolvedValue(makeQuizResponse(5));

    const { quizJson } = await generateQuizV46('article md', '{}', 5, 'medium');

    expect(mockCallVertexAI).toHaveBeenCalledTimes(1);
    expect(quizJson.questions).toHaveLength(5);
  });
});

describe('generateQuizV46 — chunked path (count > 20)', () => {
  it('splits a 25-question request into sub-batches (6+6+6+6+1) and merges them into one quiz', async () => {
    // planQuizChunks(25): QUIZ_SUB_BATCH_SIZE=6 taken greedily each iteration
    // → [6, 6, 6, 6, 1] — 5 calls.
    mockCallVertexAI
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'Batch1' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'Batch2' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'Batch3' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'Batch4' }))
      .mockResolvedValueOnce(makeQuizResponse(1, { startId: 1, questionPrefix: 'Batch5' }));

    const { quizJson } = await generateQuizV46('article md', '{}', 25, 'medium');

    expect(mockCallVertexAI).toHaveBeenCalledTimes(5);
    expect(quizJson.questions).toHaveLength(25);
    // requestedQuestionCount is preserved as the ORIGINAL admin request, not a
    // per-chunk value — this is what lets the wizard detect a partial fill.
    expect(quizJson.meta.requestedQuestionCount).toBe(25);
  });

  it('de-duplicates questions with the same normalized stem across independently-generated sub-batches', async () => {
    // Two sub-batches (>20 total) where chunk 2 repeats chunk 1's first question
    // verbatim (case/whitespace-insensitive) — a realistic risk when independent
    // batches draw from overlapping source material.
    mockCallVertexAI
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1 }))
      .mockResolvedValueOnce(
        JSON.stringify({
          meta: { promptVersion: 'v4.6-quiz' },
          questions: [
            {
              id: 'dup',
              question: '  Question 1?  ', // same stem as chunk 1's q01, different whitespace/id
              options: [
                { text: 'A', isCorrect: true },
                { text: 'B', isCorrect: false },
              ],
            },
            {
              id: 'q2',
              question: 'A genuinely new question?',
              options: [
                { text: 'A', isCorrect: true },
                { text: 'B', isCorrect: false },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 7 }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 13 }))
      .mockResolvedValueOnce(makeQuizResponse(1, { startId: 19 }));

    const { quizJson } = await generateQuizV46('article md', '{}', 25, 'medium');

    // 6 (chunk1) + 1 new (chunk2, the dup dropped) + 6 (chunk3) + 6 (chunk4) + 1 (chunk5) = 20
    expect(quizJson.questions).toHaveLength(20);
    const stems = quizJson.questions.map((q) => q.question.trim().toLowerCase());
    expect(new Set(stems).size).toBe(stems.length); // no duplicate stems survive
  });

  it('re-numbers merged question ids sequentially and uniquely regardless of source-chunk ids', async () => {
    // Every chunk's raw ids restart at q01..q0N (would collide if not
    // renumbered on merge); distinct question text per chunk keeps dedup out
    // of the picture so this test isolates renumbering specifically.
    mockCallVertexAI
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'A' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'B' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'C' }))
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'D' }))
      .mockResolvedValueOnce(makeQuizResponse(1, { startId: 1, questionPrefix: 'E' }));

    const { quizJson } = await generateQuizV46('article md', '{}', 25, 'medium');

    const ids = quizJson.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length); // every id is unique
    expect(ids).toEqual(ids.slice().sort()); // sequential q01, q02, ... in order
    expect(ids[0]).toBe('q01');
    expect(ids[ids.length - 1]).toBe(`q${String(ids.length).padStart(2, '0')}`);
  });
});

describe('generateQuizV46 — partial results on sub-batch failure', () => {
  it('returns a partial quiz (fewer than requested) when one sub-batch fails all its retries, preserving requestedQuestionCount', async () => {
    // planQuizChunks(25) = [6, 6, 6, 6, 1]. Chunk 2 fails BOTH attempts
    // (QUIZ_CHUNK_MAX_ATTEMPTS=2); the other four succeed.
    mockCallVertexAI
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'A' })) // chunk 1
      .mockRejectedValueOnce(new Error('Vertex AI 503')) // chunk 2 attempt 1
      .mockRejectedValueOnce(new Error('Vertex AI 503')) // chunk 2 attempt 2
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'C' })) // chunk 3
      .mockResolvedValueOnce(makeQuizResponse(6, { startId: 1, questionPrefix: 'D' })) // chunk 4
      .mockResolvedValueOnce(makeQuizResponse(1, { startId: 1, questionPrefix: 'E' })); // chunk 5

    const { quizJson } = await generateQuizV46('article md', '{}', 25, 'medium');

    // 6 + 0 (failed chunk) + 6 + 6 + 1 = 19, short of the 25 requested.
    expect(quizJson.questions).toHaveLength(19);
    expect(quizJson.meta.requestedQuestionCount).toBe(25); // preserved for the partial-fill UI banner
  }, 10000);

  it('retries a failed sub-batch once before giving up on it (QUIZ_CHUNK_MAX_ATTEMPTS=2)', async () => {
    mockCallVertexAI
      .mockRejectedValueOnce(new Error('transient')) // attempt 1 fails
      .mockResolvedValueOnce(makeQuizResponse(5)); // attempt 2 succeeds

    const { quizJson } = await generateQuizV46('article md', '{}', 5, 'medium');

    expect(mockCallVertexAI).toHaveBeenCalledTimes(2);
    expect(quizJson.questions).toHaveLength(5);
  });

  it('throws with a machine-readable reason when every sub-batch fails', async () => {
    mockCallVertexAI.mockRejectedValue(new Error('Vertex AI unavailable'));

    await expect(generateQuizV46('article md', '{}', 5, 'medium')).rejects.toThrow(/api_error/);
  });

  it('surfaces a validation_error reason when Vertex returns JSON that fails schema validation', async () => {
    mockCallVertexAI.mockResolvedValue(JSON.stringify({ not: 'a valid quiz shape' }));

    await expect(generateQuizV46('article md', '{}', 5, 'medium')).rejects.toThrow(
      /validation_error/,
    );
  });

  it('surfaces a parse_error reason when Vertex returns unparseable text', async () => {
    mockCallVertexAI.mockResolvedValue('not json at all {{{');

    await expect(generateQuizV46('article md', '{}', 5, 'medium')).rejects.toThrow(/parse_error/);
  });
});

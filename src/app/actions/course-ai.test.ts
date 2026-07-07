/**
 * Regression tests for the QA-002 fix in course-ai.ts:
 *
 *   analyzeDocument / analyzeStoredDocument NEVER leak raw internal error
 *   detail (e.g. a raw "Vertex AI 404 Not Found: <!DOCTYPE html>...") to the
 *   client. On an AI failure they return the sanitized
 *   ANALYSIS_FAILED_USER_MESSAGE while the raw error is logged server-side.
 *   Mirrors the THER-013 boundary fix in course-ai-v4.6.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { prismaMock, mockAuth, mockCallVertexAI, mockExtractTextFromFile } = vi.hoisted(() => {
  const prismaMock = {
    document: { findUnique: vi.fn() },
  };
  const mockAuth = vi.fn();
  const mockCallVertexAI = vi.fn();
  const mockExtractTextFromFile = vi.fn();
  return { prismaMock, mockAuth, mockCallVertexAI, mockExtractTextFromFile };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: mockExtractTextFromFile }));
vi.mock('@/lib/ai-client', () => ({
  callVertexAI: mockCallVertexAI,
  truncateToContext: (text: string) => text,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

// ---------------------------------------------------------------------------
// Import under test AFTER all vi.mock() declarations.
// ---------------------------------------------------------------------------
import { analyzeDocument, analyzeStoredDocument } from './course-ai';

// The sanitized message the fix guarantees — copied from source since it is
// not exported. If this drifts from the real constant, the equality
// assertions below will catch it.
const ANALYSIS_FAILED_USER_MESSAGE =
  "We couldn't analyze this document automatically. You can fill in the details manually or try again.";

// A representative raw backend error, of the exact class QA-002 flagged.
const RAW_VERTEX_ERROR =
  'Vertex AI 404 Not Found: <!DOCTYPE html><html><body>Not Found</body></html>';

// Enough extracted text to clear the >= 50 char pre-flight guard.
const SUFFICIENT_TEXT = 'x'.repeat(200);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analyzeDocument', () => {
  function buildFormData() {
    const formData = new FormData();
    formData.set('file', new File([SUFFICIENT_TEXT], 'source.txt', { type: 'text/plain' }));
    return formData;
  }

  it('returns the sanitized message (not the raw Vertex error) when the AI call fails', async () => {
    mockExtractTextFromFile.mockResolvedValue(SUFFICIENT_TEXT);
    mockCallVertexAI.mockRejectedValue(new Error(RAW_VERTEX_ERROR));

    const result = await analyzeDocument(buildFormData());

    expect(result.error).toBe(ANALYSIS_FAILED_USER_MESSAGE);
    expect(result.error).not.toContain('Vertex AI');
    expect(result.error).not.toContain('<!DOCTYPE');
  });
});

describe('analyzeStoredDocument', () => {
  it('returns the sanitized message (not the raw Vertex error) when the AI call fails', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      filename: 'stored.pdf',
      versions: [{ version: 1, content: SUFFICIENT_TEXT }],
    });
    mockCallVertexAI.mockRejectedValue(new Error(RAW_VERTEX_ERROR));

    const result = await analyzeStoredDocument('doc-1');

    expect(result.error).toBe(ANALYSIS_FAILED_USER_MESSAGE);
    expect(result.error).not.toContain('Vertex AI');
    expect(result.error).not.toContain('<!DOCTYPE');
  });
});

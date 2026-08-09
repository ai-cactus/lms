/**
 * Tests for course-ai.ts, covering two properties:
 *
 * 1. Error hygiene (QA-002 / THER-013): analyzeStoredDocument NEVER leaks raw
 *    internal error detail (e.g. "Vertex AI 404 Not Found: <!DOCTYPE html>...")
 *    to the client. On an AI failure it returns the sanitized
 *    ANALYSIS_FAILED_USER_MESSAGE while the raw error is logged server-side.
 *
 * 2. AI egress control (F-003 / F-012 / F-018): every path that reaches Vertex
 *    is behind an auth check, an org scope, and a rate limit — and the module
 *    exposes no action that analyses a raw, unscanned file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { prismaMock, mockAuth, mockCallVertexAI, mockCheckRateLimit } = vi.hoisted(() => {
  const prismaMock = {
    document: { findUnique: vi.fn() },
  };
  const mockAuth = vi.fn();
  const mockCallVertexAI = vi.fn();
  const mockCheckRateLimit = vi.fn();
  return { prismaMock, mockAuth, mockCallVertexAI, mockCheckRateLimit };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
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
import { analyzeStoredDocument } from './course-ai';

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

describe('course-ai module surface', () => {
  /**
   * `analyzeDocument(formData)` was a `'use server'` action that took a raw
   * File and forwarded its extracted text to Vertex AI with no auth check, no
   * rate limit and no PHI scan. Server actions are independently invokable
   * HTTP endpoints, so the wizard's upload-then-analyse sequencing was not a
   * control. It was removed in favour of analyzeStoredDocument, which only
   * ever reads text that already passed the fail-closed scanText gate.
   *
   * This asserts the export stays gone: re-adding a File-taking analysis
   * action would silently reopen an ungated PHI egress path.
   */
  it('exposes no action that analyses a raw file without a PHI scan', async () => {
    const mod: Record<string, unknown> = await import('./course-ai');

    expect(mod.analyzeDocument).toBeUndefined();
    expect(Object.keys(mod).filter((k) => typeof mod[k] === 'function')).toEqual([
      'analyzeStoredDocument',
    ]);
  });
});

describe('analyzeStoredDocument', () => {
  const authedSession = { user: { id: 'user-1', organizationUserId: 'ou-1' } };

  function mockStoredDoc() {
    prismaMock.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      filename: 'stored.pdf',
      versions: [{ version: 1, content: SUFFICIENT_TEXT }],
    });
  }

  it('returns the sanitized message (not the raw Vertex error) when the AI call fails', async () => {
    mockAuth.mockResolvedValue(authedSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, resetInSeconds: 0 });
    mockStoredDoc();
    mockCallVertexAI.mockRejectedValue(new Error(RAW_VERTEX_ERROR));

    const result = await analyzeStoredDocument('doc-1');

    expect(result.error).toBe(ANALYSIS_FAILED_USER_MESSAGE);
    expect(result.error).not.toContain('Vertex AI');
    expect(result.error).not.toContain('<!DOCTYPE');
  });

  // Unauthenticated callers must never reach Vertex: this action is a directly
  // invokable server action, so the session check is the only thing standing
  // between an anonymous POST and billable AI egress.
  it('refuses unauthenticated callers without calling Vertex', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await analyzeStoredDocument('doc-1');

    expect(result.error).toBe('Unauthorized');
    expect(mockCallVertexAI).not.toHaveBeenCalled();
    expect(prismaMock.document.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a session with no organization membership', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const result = await analyzeStoredDocument('doc-1');

    expect(result.error).toBe('Unauthorized');
    expect(mockCallVertexAI).not.toHaveBeenCalled();
  });

  // F-018: an authenticated caller must not be able to replay the action to
  // drive unbounded Vertex spend.
  it('stops at the rate limit without calling Vertex', async () => {
    mockAuth.mockResolvedValue(authedSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, resetInSeconds: 42 });
    mockStoredDoc();

    const result = await analyzeStoredDocument('doc-1');

    expect(result.error).toContain('42');
    expect(mockCallVertexAI).not.toHaveBeenCalled();
  });

  // Tenancy: the document lookup is scoped to the caller's own
  // organizationUserId, so another org's document is simply not found.
  it('scopes the document lookup to the caller organization', async () => {
    mockAuth.mockResolvedValue(authedSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, resetInSeconds: 0 });
    prismaMock.document.findUnique.mockResolvedValue(null);

    const result = await analyzeStoredDocument('other-org-doc');

    expect(result.error).toBe('Document not found');
    expect(prismaMock.document.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationUserId: 'ou-1' }),
      }),
    );
    expect(mockCallVertexAI).not.toHaveBeenCalled();
  });
});

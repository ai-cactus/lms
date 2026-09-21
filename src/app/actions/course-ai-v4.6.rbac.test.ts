/**
 * RBAC gate on the v4.6 generation orchestrator.
 *
 * `generateCourseAndQuizV46` is a `'use server'` export, i.e. a directly
 * invokable HTTP endpoint, and it was authenticated-only: route protection in
 * `src/proxy.ts` is two-bucket (admin vs worker) and performs no module-level
 * check, so every admin-tier role — Finance and Supervisor included, neither of
 * which may build a course — could drive the whole Vertex pipeline by calling
 * it. The gate is `course.create`, the same verb `createCourse()` checks.
 *
 * The gate must also run BEFORE any work: a denied caller must not reach file
 * buffering, text extraction, the PHI scan, the rate limiter or a Job row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAuth,
  mockCallVertexAI,
  mockAfter,
  mockExtractTextFromFile,
  mockScanText,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  prismaMock: {
    job: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    document: { findUnique: vi.fn() },
  },
  mockAuth: vi.fn(),
  mockCallVertexAI: vi.fn(),
  // Swallow the background pipeline entirely — this suite is about the
  // foreground gate, never about what after() would go on to do.
  mockAfter: vi.fn(),
  mockExtractTextFromFile: vi.fn(),
  mockScanText: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: mockExtractTextFromFile }));
vi.mock('@/lib/rag', () => ({ retrieveRelevantChunks: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: mockScanText }));
vi.mock('@/lib/documents/phiDecision', () => ({ recordPhiDecision: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: vi.fn() }));
// Spread the real module rather than listing exports by hand: the code under
// test also reads interactiveBudget/VertexBudgetExceededError from here, and a
// partial factory turns a new export into an `undefined is not a function`
// TypeError inside the code under test.
vi.mock('@/lib/ai-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-client')>()),
  callVertexAI: mockCallVertexAI,
  truncateToContext: (text: string) => text,
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mockAfter };
});

import { generateCourseAndQuizV46 } from './course-ai-v4.6';
import { logger } from '@/lib/logger';

function buildFormData() {
  const formData = new FormData();
  formData.set('data', JSON.stringify({ title: 'Test Course' }));
  formData.set('file', new File(['source content'], 'source.txt', { type: 'text/plain' }));
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractTextFromFile.mockResolvedValue('x'.repeat(200));
  mockScanText.mockResolvedValue({ hasPHI: false, scanFailed: false, findings: [] });
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 600 });
  prismaMock.job.create.mockResolvedValue({ id: 'job-1' });
});

describe('generateCourseAndQuizV46 — course.create enforcement', () => {
  it('refuses an unauthenticated caller', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await generateCourseAndQuizV46(buildFormData());

    expect(result).toEqual({ error: 'Unauthorized' });
    expect(prismaMock.job.create).not.toHaveBeenCalled();
    expect(mockExtractTextFromFile).not.toHaveBeenCalled();
  });

  // Finance and Supervisor are the two admin-tier roles this closes: both reach
  // every /dashboard route through proxy.ts's admin bucket, and neither holds a
  // single course-write verb. Workers are covered by the same check.
  it.each(['finance', 'supervisor', 'nurse', 'front_desk_admin'])(
    'refuses role=%s before extraction, PHI scan, rate limit or Job creation',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-x', role, organizationUserId: 'ou-x' } });

      const result = await generateCourseAndQuizV46(buildFormData());

      expect(result).toEqual({ error: 'Insufficient permissions' });
      expect(mockExtractTextFromFile).not.toHaveBeenCalled();
      expect(mockScanText).not.toHaveBeenCalled();
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
      expect(prismaMock.job.create).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    },
  );

  it('logs the denial with userId and role, and never an email', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-x', role: 'finance', email: 'cfo@example.com' },
    });

    await generateCourseAndQuizV46(buildFormData());

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-x', role: 'finance' }),
    );
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain('cfo@example.com');
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'allows role=%s through to Job creation',
    async (role) => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1', role, organizationUserId: 'ou-1' } });

      const result = await generateCourseAndQuizV46(buildFormData());

      expect(result).toEqual({ jobId: 'job-1' });
      expect(prismaMock.job.create).toHaveBeenCalledTimes(1);
    },
  );

  // An unknown/stale role on a JWT minted before a role was renamed must deny,
  // not throw and not pass — `can()` is least-privilege by construction.
  it('denies an unknown role rather than throwing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-x', role: 'retired_role' } });

    await expect(generateCourseAndQuizV46(buildFormData())).resolves.toEqual({
      error: 'Insufficient permissions',
    });
  });
});

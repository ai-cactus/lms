/**
 * Phase 6 fan-out: `startModuleGenerationJobs` starts one v4.6 job per wizard
 * module through the unchanged single-document pipeline, keeps each module's
 * result addressable by `moduleIndex`, and isolates a module that fails to
 * start so the rest of the batch still runs.
 *
 * The question-share math and the per-module payload it produces are covered
 * directly in `src/lib/course/module-generation.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAuth, mockAfter, mockCheckRateLimit } = vi.hoisted(() => ({
  prismaMock: {
    job: { create: vi.fn() },
    document: { findUnique: vi.fn() },
  },
  mockAuth: vi.fn(),
  // Background pipelines are out of scope here — swallow the scheduled work.
  mockAfter: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/rag', () => ({ retrieveRelevantChunks: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/documents/phiScanner', () => ({ scanText: vi.fn() }));
vi.mock('@/lib/file-parser', () => ({ extractTextFromFile: vi.fn() }));
vi.mock('@/lib/ai-client', () => ({
  callVertexAI: vi.fn(),
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

import { startModuleGenerationJobs } from './course-ai-v4.6';
import { WIZARD_FORM_DATA } from '@/components/dashboard/courses/steps/wizardTestData';

const COURSE_DATA = { ...WIZARD_FORM_DATA, quizQuestionCount: '15' };

const MODULES = [
  { moduleIndex: 0, documentId: 'doc-1', title: 'Hand Hygiene', objective: 'Wash hands' },
  { moduleIndex: 1, documentId: 'doc-2', title: 'PPE', objective: 'Wear PPE' },
];

function storedDocument(id: string) {
  return {
    id,
    filename: `${id}.pdf`,
    versions: [{ content: 'Policy text long enough to pass the minimum length gate.' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'admin-1', organizationUserId: 'ou-admin-1' },
  });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  prismaMock.document.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    storedDocument(where.id),
  );
  let created = 0;
  prismaMock.job.create.mockImplementation(async () => ({ id: `job-${created++}` }));
});

describe('startModuleGenerationJobs', () => {
  it('starts one job per module and returns them keyed by module', async () => {
    const { jobs, error } = await startModuleGenerationJobs(COURSE_DATA, MODULES);

    expect(error).toBeUndefined();
    expect(prismaMock.job.create).toHaveBeenCalledTimes(2);
    expect(jobs).toEqual([
      { moduleIndex: 0, jobId: 'job-0', error: undefined },
      { moduleIndex: 1, jobId: 'job-1', error: undefined },
    ]);
  });

  it('generates each module from its own source document', async () => {
    await startModuleGenerationJobs(COURSE_DATA, MODULES);

    expect(prismaMock.document.findUnique.mock.calls.map(([args]) => args.where.id)).toEqual([
      'doc-1',
      'doc-2',
    ]);
  });

  it('reports a module that could not start without failing the batch', async () => {
    prismaMock.document.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === 'doc-2' ? null : storedDocument(where.id),
    );

    const { jobs } = await startModuleGenerationJobs(COURSE_DATA, MODULES);

    expect(jobs[0]).toEqual({ moduleIndex: 0, jobId: 'job-0', error: undefined });
    expect(jobs[1]).toEqual({ moduleIndex: 1, jobId: undefined, error: 'Document not found' });
  });

  it('rejects an empty module list', async () => {
    const { jobs, error } = await startModuleGenerationJobs(COURSE_DATA, []);

    expect(jobs).toEqual([]);
    expect(error).toContain('at least one module');
    expect(prismaMock.job.create).not.toHaveBeenCalled();
  });
});

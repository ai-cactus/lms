/**
 * Contract for the course preview-poster route — the catalog card thumbnail.
 *
 * Authorization mirrors /api/courses/[id]/preview-video, and the warm-cache case
 * is what makes a 12-card page cost one query instead of twelve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, mockCourseFindUnique, mockEnrollmentFindFirst, mockSign } =
  vi.hoisted(() => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockCourseFindUnique: vi.fn(),
    mockEnrollmentFindFirst: vi.fn(),
    mockSign: vi.fn(),
  }));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/storage', () => ({ getSignedUrl: (...a: unknown[]) => mockSign(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';
import { logger } from '@/lib/logger';

const POSTER_URI = 'gcs://lms/system/videos/posters/1-abc.jpg';
const SIGNED = 'https://storage.googleapis.com/lms/system/videos/posters/1-abc.jpg?sig=x';

const CACHE_ENV_KEYS = [
  'VIDEO_PLAYBACK_CACHE_TTL_SECONDS',
  'VIDEO_POSTER_MAX_AGE_SECONDS',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  CACHE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

/** Unique per case — the playback cache is process-wide module state. */
let courseSeq = 0;
function nextCourseId(): string {
  courseSeq += 1;
  return `course-${courseSeq}`;
}

const makeReq = () => new Request('http://localhost/api/courses/x/preview-poster');

const makeCourse = (opts?: {
  createdBy?: string;
  previewPosterStorageUri?: string | null;
  isGlobal?: boolean;
}) => ({
  previewPosterStorageUri:
    opts && 'previewPosterStorageUri' in opts ? opts.previewPosterStorageUri : POSTER_URI,
  createdBy: opts?.createdBy ?? 'other-org-user',
  isGlobal: opts?.isGlobal ?? false,
  status: 'published',
  type: 'video',
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
  delete process.env.VIDEO_POSTER_MAX_AGE_SECONDS;
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockSign.mockResolvedValue(SIGNED);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('jpeg', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of CACHE_ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('GET /api/courses/[id]/preview-poster', () => {
  it('401 when neither portal session is authenticated', async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });
    expect(res.status).toBe(401);
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('404 when the course does not exist', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });
    expect(res.status).toBe(404);
  });

  it('403 for a private course the caller neither created nor is enrolled in', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-outsider' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse());
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });

    expect(res.status).toBe(403);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('allows any signed-in user for the published global catalog', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-outsider' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ isGlobal: true }));

    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });

    expect(res.status).toBe(200);
    // The global-catalog shortcut must not cost an enrollment lookup.
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('404s when the course has no poster yet, without touching storage', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ isGlobal: true, previewPosterStorageUri: null }),
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('serves the image with an immutable private cache policy', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ isGlobal: true }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('jpeg', {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '4096' },
        }),
      ),
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe('4096');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('returns 499 on a client abort without logging an error', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ isGlobal: true }));
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const res = await GET(makeReq(), { params: Promise.resolve({ id: nextCourseId() }) });

    expect(res.status).toBe(499);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('serves a warm cache with zero database lookups', async () => {
    process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '60';
    const id = nextCourseId();
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ isGlobal: true }));

    await Promise.all([
      GET(makeReq(), { params: Promise.resolve({ id }) }),
      GET(makeReq(), { params: Promise.resolve({ id }) }),
      GET(makeReq(), { params: Promise.resolve({ id }) }),
    ]);
    await GET(makeReq(), { params: Promise.resolve({ id }) });

    // Single-flight collapses the parallel burst too, not just the warm reads.
    expect(mockCourseFindUnique).toHaveBeenCalledOnce();
    expect(mockSign).toHaveBeenCalledOnce();
  });
});

/**
 * Contract for the lesson poster route.
 *
 * The poster is a frame of the video, so its authorization must match
 * /api/video/[lessonId] exactly — a weaker rule here would leak a still from a
 * course the caller can't watch. The cache policy is the other load-bearing
 * assertion: `immutable` is what removes the per-card revalidation round trip a
 * catalog page would otherwise pay.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, mockLessonFindUnique, mockEnrollmentFindFirst, mockSign } =
  vi.hoisted(() => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockLessonFindUnique: vi.fn(),
    mockEnrollmentFindFirst: vi.fn(),
    mockSign: vi.fn(),
  }));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    lesson: { findUnique: (...a: unknown[]) => mockLessonFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/storage', () => ({ getSignedUrl: (...a: unknown[]) => mockSign(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';
import { logger } from '@/lib/logger';

const POSTER_URI = 'minio://lms-documents/system/videos/posters/1-abc.jpg';
const SIGNED = 'http://minio:9000/lms-documents/system/videos/posters/1-abc.jpg';

const CACHE_ENV_KEYS = [
  'VIDEO_PLAYBACK_CACHE_TTL_SECONDS',
  'VIDEO_POSTER_MAX_AGE_SECONDS',
] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  CACHE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

/**
 * Each case uses its own lesson id: the playback cache is process-wide module
 * state, so a shared id would let one test's cached row satisfy the next one.
 */
let lessonSeq = 0;
function nextLessonId(): string {
  lessonSeq += 1;
  return `lesson-${lessonSeq}`;
}

const makeReq = (headers?: Record<string, string>, signal?: AbortSignal) =>
  new Request('http://localhost/api/video/x/poster', { headers, signal });

const makeLesson = (opts?: {
  createdBy?: string;
  videoPosterStorageUri?: string | null;
  isGlobal?: boolean;
}) => ({
  videoPosterStorageUri:
    opts && 'videoPosterStorageUri' in opts ? opts.videoPosterStorageUri : POSTER_URI,
  course: {
    id: 'course-1',
    createdBy: opts?.createdBy ?? 'other-org-user',
    isGlobal: opts?.isGlobal ?? false,
    status: 'published',
    type: 'video',
  },
});

function stubFetch(response: Response | Error) {
  const fetchMock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Caching off by default so each case exercises the real lookups; the cache
  // case below turns it on explicitly.
  process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
  delete process.env.VIDEO_POSTER_MAX_AGE_SECONDS;
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockSign.mockResolvedValue(SIGNED);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of CACHE_ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('GET /api/video/[lessonId]/poster', () => {
  it('401 when neither portal session is authenticated', async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });
    expect(res.status).toBe(401);
    expect(mockLessonFindUnique).not.toHaveBeenCalled();
  });

  it('404 when the lesson does not exist', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockLessonFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });
    expect(res.status).toBe(404);
  });

  it('403 when the caller is neither creator, enrolled, nor browsing the global catalog', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-outsider' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-someone' }));
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(res.status).toBe(403);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('allows the course creator', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-creator' }));
    stubFetch(new Response('jpeg', { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(res.status).toBe(200);
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('allows an enrolled learner', async () => {
    mockWorkerAuth.mockResolvedValue({ user: { id: 'ou-worker' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    stubFetch(new Response('jpeg', { status: 200 }));

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(res.status).toBe(200);
  });

  it('404s when the lesson has no poster yet, without touching storage', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ createdBy: 'ou-creator', videoPosterStorageUri: null }),
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
    // Uncached, so the card stops 404ing the moment the backfill lands a poster.
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('serves the image with an immutable private cache policy', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-creator' }));
    const fetchMock = stubFetch(
      new Response('jpeg', {
        status: 200,
        headers: { 'content-type': 'image/jpeg', etag: '"abc"' },
      }),
    );

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(fetchMock).toHaveBeenCalledWith(SIGNED, expect.objectContaining({ headers: {} }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('relays a 304 with no body and no entity headers', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-creator' }));
    const fetchMock = stubFetch(
      new Response(null, {
        status: 304,
        headers: { etag: '"abc"', 'content-length': '4096' },
      }),
    );

    const res = await GET(makeReq({ 'if-none-match': '"abc"' }), {
      params: Promise.resolve({ lessonId: nextLessonId() }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      SIGNED,
      expect.objectContaining({ headers: { 'If-None-Match': '"abc"' } }),
    );
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('returns 499 on a client abort without logging an error', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-creator' }));
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    stubFetch(abortError);

    const res = await GET(makeReq(), { params: Promise.resolve({ lessonId: nextLessonId() }) });

    expect(res.status).toBe(499);
    // A catalog page navigating away cancels a dozen of these at once — logging
    // them would flood the logs with non-events.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('serves a warm cache with zero database lookups', async () => {
    process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '60';
    const lessonId = nextLessonId();
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-creator' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'ou-creator' }));
    stubFetch(new Response('jpeg', { status: 200 }));

    await GET(makeReq(), { params: Promise.resolve({ lessonId }) });
    await GET(makeReq(), { params: Promise.resolve({ lessonId }) });
    await GET(makeReq(), { params: Promise.resolve({ lessonId }) });

    // This is the whole point on a catalog page: N cards, one query.
    expect(mockLessonFindUnique).toHaveBeenCalledOnce();
    expect(mockSign).toHaveBeenCalledOnce();
  });
});

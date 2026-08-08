import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockLessonFindUnique,
  mockLessonUpdateMany,
  mockEnrollmentFindFirst,
  mockResolvePlaybackUrl,
  mockResolveVideoSource,
} = vi.hoisted(() => {
  const mockResolvePlaybackUrl = vi.fn();
  return {
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockLessonFindUnique: vi.fn(),
    mockLessonUpdateMany: vi.fn(),
    mockEnrollmentFindFirst: vi.fn(),
    mockResolvePlaybackUrl,
    mockResolveVideoSource: vi.fn<
      (provider: string) => { resolvePlaybackUrl: typeof mockResolvePlaybackUrl }
    >(() => ({ resolvePlaybackUrl: mockResolvePlaybackUrl })),
  };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    lesson: {
      findUnique: (...a: unknown[]) => mockLessonFindUnique(...a),
      updateMany: (...a: unknown[]) => mockLessonUpdateMany(...a),
    },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/video', () => ({
  resolveVideoSource: (provider: string) => mockResolveVideoSource(provider),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';
import { logger } from '@/lib/logger';

const makeReq = (range?: string) =>
  new Request('http://localhost/api/video/lesson-1', {
    headers: range ? { range } : {},
  });
const params = Promise.resolve({ lessonId: 'lesson-1' });

const makeLesson = (opts?: {
  createdBy?: string;
  videoStorageUri?: string | null;
  videoProvider?: string | null;
}) => ({
  id: 'lesson-1',
  // Distinguish "not passed" (use default) from an explicit null/undefined override.
  videoProvider: opts && 'videoProvider' in opts ? opts.videoProvider : 'self',
  videoStorageUri:
    opts && 'videoStorageUri' in opts
      ? opts.videoStorageUri
      : 'minio://lms-documents/system/videos/v.mp4',
  videoDurationSeconds: 600,
  course: {
    id: 'course-1',
    createdBy: opts?.createdBy ?? 'other-user',
  },
});

const CACHE_ENV_KEYS = [
  'VIDEO_PLAYBACK_CACHE_TTL_SECONDS',
  'VIDEO_CACHE_MAX_AGE_SECONDS',
  'VIDEO_SIGNED_URL_TTL_SECONDS',
] as const;

const ORIGINAL_CACHE_ENV: Record<string, string | undefined> = Object.fromEntries(
  CACHE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  vi.clearAllMocks();
  // Equivalence proof: unless a case says otherwise, both playback-caching kill
  // switches sit at their DISABLING values, so every pre-existing assertion
  // below exercises byte-identical behavior to before proxy caching landed.
  process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
  process.env.VIDEO_CACHE_MAX_AGE_SECONDS = '0';
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockResolvePlaybackUrl.mockResolvedValue('http://minio:9000/lms-documents/system/videos/v.mp4');
  mockLessonUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  for (const key of CACHE_ENV_KEYS) {
    const original = ORIGINAL_CACHE_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('GET /api/video/[lessonId]', () => {
  it('401 when no session', async () => {
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(401);
    expect(mockLessonFindUnique).not.toHaveBeenCalled();
  });

  it('404 when the lesson does not exist', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockLessonFindUnique.mockResolvedValue(null);
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(404);
  });

  it('403 when caller is neither creator nor enrolled', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'outsider' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'someone' }));
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(403);
    expect(mockResolveVideoSource).not.toHaveBeenCalled();
  });

  it('404 when the lesson has no video', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ videoStorageUri: null }));
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(404);
  });

  it('proxies the stream, forwards Range, and passes through storage headers', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    mockLessonFindUnique.mockResolvedValue(makeLesson());

    const fetchMock = vi.fn().mockResolvedValue(
      new Response('partial-bytes', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-11/12',
          'content-length': '12',
          'accept-ranges': 'bytes',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(mockResolveVideoSource).toHaveBeenCalledWith('self');
    // Range header forwarded to storage
    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/v.mp4',
      expect.objectContaining({ headers: { Range: 'bytes=0-' } }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-range')).toBe('bytes 0-11/12');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    vi.unstubAllGlobals();
  });

  it('falls back to the "self" provider when videoProvider is null', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ videoProvider: null }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await GET(makeReq(), { params });
    expect(mockResolveVideoSource).toHaveBeenCalledWith('self');

    vi.unstubAllGlobals();
  });
});

describe('GET /api/video/[lessonId] — Issue #7/#9: honest mediaStatus on upstream storage errors', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
  });

  it('flips the lesson mediaStatus to failed on a definitive upstream 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })));

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(404);
    expect(mockLessonUpdateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'lesson-1', mediaStatus: { not: 'failed' } },
      data: { mediaStatus: 'failed' },
    });

    vi.unstubAllGlobals();
  });

  it('is idempotent — the where-clause guard means a second 404 does not re-issue a redundant write to an already-failed lesson', async () => {
    // The guard itself (`mediaStatus: { not: 'failed' }`) is what makes a repeat
    // 404 a no-op at the DB level; here we assert the route always issues the
    // SAME guarded call regardless of the lesson's current status, never a bare
    // unconditional update that could stomp a status set by something else.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })));

    await GET(makeReq(), { params });

    expect(mockLessonUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mediaStatus: { not: 'failed' } }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it.each([500, 502, 503, 403])(
    'does NOT flip mediaStatus on a transient/config upstream error (%i)',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status })));

      const res = await GET(makeReq(), { params });

      expect(res.status).toBe(status);
      expect(mockLessonUpdateMany).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    },
  );

  it('never flips mediaStatus, and never touches the DB write path, on the happy 200/206 path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 200 })));

    await GET(makeReq(), { params });

    expect(mockLessonUpdateMany).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('GET /api/video/[lessonId] — abort handling and narrow select', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
  });

  it('forwards the request signal to the upstream fetch and returns 499 with no logger.error when it aborts', async () => {
    const controller = new AbortController();
    const req = new Request('http://localhost/api/video/lesson-1', { signal: controller.signal });
    controller.abort();

    // This route runs server-side under Node, where a fetch abort rejects with
    // a DOMException that IS an `Error` (confirmed against this repo's Node
    // runtime). jsdom's global `DOMException` — this file's test environment —
    // does NOT extend `Error`, so constructing one here would test jsdom's
    // shape instead of Node's; build the Error-shaped rejection the route's
    // `err instanceof Error` check actually expects in production.
    const abortErr = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(req, { params });

    expect(res.status).toBe(499);
    expect(logger.error).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/v.mp4',
      expect.objectContaining({ signal: req.signal }),
    );

    vi.unstubAllGlobals();
  });

  it('logs an error and returns 502 on a genuine (non-abort) fetch rejection', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(502);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[video-proxy] failed to fetch from storage',
        lessonId: 'lesson-1',
      }),
    );

    vi.unstubAllGlobals();
  });

  it('does not select the AI-pipeline artifact columns on the course relation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 200 })));

    await GET(makeReq(), { params });

    expect(mockLessonFindUnique).toHaveBeenCalledTimes(1);
    const call = mockLessonFindUnique.mock.calls[0][0] as {
      select: { course: { select: Record<string, unknown> } };
    };
    const courseSelect = call.select.course.select;
    for (const forbidden of [
      'rawCourseJson',
      'rawQuizJson',
      'rawSlidesJson',
      'rawArticleMarkdown',
      'rawJudgeJson',
    ]) {
      expect(courseSelect).not.toHaveProperty(forbidden);
    }

    vi.unstubAllGlobals();
  });
});

describe('GET /api/video/[lessonId] — conditional requests', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards If-Range, If-None-Match and If-Modified-Since alongside Range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 206 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('http://localhost/api/video/lesson-1', {
      headers: {
        range: 'bytes=100-',
        'if-range': '"etag-v1"',
        'if-none-match': '"etag-v1"',
        'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      },
    });
    await GET(req, { params });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/v.mp4',
      expect.objectContaining({
        headers: {
          Range: 'bytes=100-',
          'If-Range': '"etag-v1"',
          'If-None-Match': '"etag-v1"',
          'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
        },
      }),
    );
  });

  it('sends no conditional headers when the browser sent none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await GET(makeReq(), { params });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/v.mp4',
      expect.objectContaining({ headers: {} }),
    );
  });

  it('passes a 304 through with NO body and without content-length/content-range', async () => {
    // Upstream 304s legitimately carry validators; some storages also echo
    // entity headers. Re-emitting those on a bodyless 304 is a spec violation
    // that makes clients treat the response as truncated.
    const upstream = new Response(null, {
      status: 304,
      headers: {
        etag: '"etag-v1"',
        'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
        'content-length': '4096',
        'content-range': 'bytes 0-4095/8192',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"etag-v1"');
    expect(res.headers.get('last-modified')).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-range')).toBeNull();
  });

  it('treats a 304 as a success — no error log, and never flips mediaStatus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));

    await GET(makeReq(), { params });

    expect(logger.error).not.toHaveBeenCalled();
    expect(mockLessonUpdateMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/video/[lessonId] — browser cache headers', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits private max-age plus Vary: Cookie by default', async () => {
    delete process.env.VIDEO_CACHE_MAX_AGE_SECONDS;

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('applies the same policy to a 304', async () => {
    delete process.env.VIDEO_CACHE_MAX_AGE_SECONDS;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('cache-control')).toBe('private, max-age=900');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('VIDEO_CACHE_MAX_AGE_SECONDS=0 restores no-store with no Vary', async () => {
    process.env.VIDEO_CACHE_MAX_AGE_SECONDS = '0';

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toBeNull();
  });
});

describe('GET /api/video/[lessonId] — content-type and accept-ranges defaults', () => {
  /**
   * A Response built from a STRING body gets `content-type: text/plain` for
   * free, which would mask the fallback under test. A null body carries no
   * entity headers, which is what a header-only assertion needs.
   */
  const upstreamResponse = (status: number, headers: Record<string, string> = {}) =>
    vi.fn().mockResolvedValue(new Response(null, { status, headers }));

  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advertise range support on a 200 that upstream did not mark range-capable', async () => {
    // A 200 answering a Range request means upstream could NOT honour one.
    // Claiming `accept-ranges: bytes` there makes iOS keep issuing range
    // requests that each pull the whole file back down.
    vi.stubGlobal('fetch', upstreamResponse(200));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBeNull();
  });

  it('still passes through an accept-ranges that upstream sent on a 200', async () => {
    vi.stubGlobal('fetch', upstreamResponse(200, { 'accept-ranges': 'bytes' }));

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  it('defaults accept-ranges on a genuine 206', async () => {
    vi.stubGlobal('fetch', upstreamResponse(206));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  it('derives the content-type from the storage key rather than asserting mp4', async () => {
    // A raw upload still plays when the transcode never ran, and the uploader
    // accepts WebM — labelling VP8/VP9 as video/mp4 is unplayable on iOS.
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ videoStorageUri: 'minio://lms-documents/system/videos/raw/clip.webm' }),
    );
    vi.stubGlobal('fetch', upstreamResponse(206));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('content-type')).toBe('video/webm');
  });

  it('omits content-type entirely for an extension it cannot vouch for', async () => {
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ videoStorageUri: 'minio://lms-documents/system/videos/raw/clip' }),
    );
    vi.stubGlobal('fetch', upstreamResponse(206));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('content-type')).toBeNull();
  });

  it('never overrides a content-type upstream did send', async () => {
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ videoStorageUri: 'minio://lms-documents/system/videos/raw/clip.webm' }),
    );
    vi.stubGlobal('fetch', upstreamResponse(206, { 'content-type': 'video/mp4' }));

    const res = await GET(makeReq('bytes=0-'), { params });

    expect(res.headers.get('content-type')).toBe('video/mp4');
  });
});

describe('GET /api/video/[lessonId] — warm playback cache', () => {
  /**
   * The caches are in-process module state, so each case gets a fresh copy of
   * the route (and therefore of the cache) rather than inheriting entries from
   * the previous one.
   */
  async function loadRoute(): Promise<typeof GET> {
    vi.resetModules();
    return (await import('./route')).GET;
  }

  beforeEach(() => {
    delete process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;
    delete process.env.VIDEO_CACHE_MAX_AGE_SECONDS;
    mockAdminAuth.mockResolvedValue({ user: { id: 'ou-1' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson());
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('costs ZERO Prisma queries and ZERO signings once warm — the core perf claim', async () => {
    const get = await loadRoute();
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 206 }));
    vi.stubGlobal('fetch', fetchMock);

    await get(makeReq('bytes=0-'), { params });
    expect(mockLessonFindUnique).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockResolvePlaybackUrl).toHaveBeenCalledTimes(1);

    // A realistic follow-on burst of Range requests for the same lesson.
    for (let i = 0; i < 8; i++) {
      const res = await get(makeReq(`bytes=${i * 1000}-`), { params });
      expect(res.status).toBe(206);
    }

    expect(mockLessonFindUnique).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockResolvePlaybackUrl).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('mints the signed URL for the raised 3600s expiry', async () => {
    const get = await loadRoute();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));

    await get(makeReq(), { params });

    expect(mockResolvePlaybackUrl).toHaveBeenCalledWith(expect.anything(), 3600);
  });

  it('never caches a 403 — a learner who enrolls mid-session is not stuck on a stale deny', async () => {
    const get = await loadRoute();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));
    mockEnrollmentFindFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'e1' });

    expect((await get(makeReq(), { params })).status).toBe(403);
    expect((await get(makeReq(), { params })).status).toBe(206);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(2);
  });

  it('a burst of concurrent cold Range requests performs ONE query and ONE signing', async () => {
    const get = await loadRoute();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => get(makeReq(`bytes=${i * 1000}-`), { params })),
    );

    expect(mockLessonFindUnique).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockResolvePlaybackUrl).toHaveBeenCalledTimes(1);
  });
});

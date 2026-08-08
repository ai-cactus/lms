import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockEnrollmentFindFirst,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockRejectedValue(new Error('no request scope')),
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/storage', () => ({ getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';
import { logger } from '@/lib/logger';

const makeReq = () => new Request('http://localhost/api/courses/course-1/preview-video');
const params = Promise.resolve({ id: 'course-1' });

const makeCourse = (opts?: {
  createdByOrgUserId?: string;
  isGlobal?: boolean;
  status?: string;
  previewVideoStorageUri?: string | null;
}) => ({
  previewVideoStorageUri:
    opts && 'previewVideoStorageUri' in opts
      ? opts.previewVideoStorageUri
      : 'minio://lms-documents/system/videos/preview.mp4',
  isGlobal: opts?.isGlobal ?? false,
  status: opts?.status ?? 'published',
  type: 'video',
  createdByOrgUserId: opts?.createdByOrgUserId ?? 'other-org-user',
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
  mockGetSignedUrl.mockResolvedValue('http://minio:9000/lms-documents/system/videos/preview.mp4');
});

afterEach(() => {
  for (const key of CACHE_ENV_KEYS) {
    const original = ORIGINAL_CACHE_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('GET /api/courses/[id]/preview-video — auth resolution', () => {
  it('401 when neither portal session is authenticated', async () => {
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(401);
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('200 when only the worker session is authenticated and the course is global/published', async () => {
    mockWorkerAuth.mockResolvedValue({ user: { id: 'w1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ isGlobal: true }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 200 })));

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('403 when the caller is neither the creator, enrolled, nor viewing a global catalog course', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-admin' } });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ createdByOrgUserId: 'someone-else', isGlobal: false }),
    );
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(403);
  });

  it('404 when the course has no preview video', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ createdByOrgUserId: 'ou-1', previewVideoStorageUri: null }),
    );

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/courses/[id]/preview-video — abort handling', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ createdByOrgUserId: 'ou-1' }));
  });

  it('forwards the request signal to the upstream fetch and returns 499 with no logger.error when it aborts', async () => {
    const controller = new AbortController();
    const req = new Request('http://localhost/api/courses/course-1/preview-video', {
      signal: controller.signal,
    });
    controller.abort();

    // See src/app/api/video/[lessonId]/route.test.ts for why this is a plain
    // Error rather than jsdom's non-Error-extending global DOMException.
    const abortErr = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(req, { params });

    expect(res.status).toBe(499);
    expect(logger.error).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/preview.mp4',
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
        msg: '[preview-video-proxy] failed to fetch from storage',
        courseId: 'course-1',
      }),
    );

    vi.unstubAllGlobals();
  });
});

describe('GET /api/courses/[id]/preview-video — conditional requests', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ createdByOrgUserId: 'ou-1' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards If-Range, If-None-Match and If-Modified-Since alongside Range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 206 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('http://localhost/api/courses/course-1/preview-video', {
      headers: {
        range: 'bytes=100-',
        'if-range': '"etag-v1"',
        'if-none-match': '"etag-v1"',
        'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      },
    });
    await GET(req, { params });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://minio:9000/lms-documents/system/videos/preview.mp4',
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

  it('passes a 304 through with NO body and without content-length/content-range', async () => {
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

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
    expect(res.headers.get('etag')).toBe('"etag-v1"');
    expect(res.headers.get('last-modified')).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-range')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('GET /api/courses/[id]/preview-video — content-type and accept-ranges defaults', () => {
  // A string body would come with a free `content-type: text/plain`, masking
  // the fallback under test.
  const upstreamResponse = (status: number) =>
    vi.fn().mockResolvedValue(new Response(null, { status }));

  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ createdByOrgUserId: 'ou-1' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advertise range support on a non-range-capable 200', async () => {
    vi.stubGlobal('fetch', upstreamResponse(200));

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('accept-ranges')).toBeNull();
  });

  it('derives the content-type from the storage key rather than asserting mp4', async () => {
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({
        createdByOrgUserId: 'ou-1',
        previewVideoStorageUri: 'minio://lms-documents/system/videos/preview.webm',
      }),
    );
    vi.stubGlobal('fetch', upstreamResponse(206));

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('content-type')).toBe('video/webm');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });
});

describe('GET /api/courses/[id]/preview-video — browser cache headers', () => {
  beforeEach(() => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ createdByOrgUserId: 'ou-1' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the longer catalog max-age plus Vary: Cookie', async () => {
    delete process.env.VIDEO_CACHE_MAX_AGE_SECONDS;

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('VIDEO_CACHE_MAX_AGE_SECONDS=0 restores no-store with no Vary', async () => {
    process.env.VIDEO_CACHE_MAX_AGE_SECONDS = '0';

    const res = await GET(makeReq(), { params });

    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toBeNull();
  });
});

describe('GET /api/courses/[id]/preview-video — warm playback cache', () => {
  async function loadRoute(): Promise<typeof GET> {
    vi.resetModules();
    return (await import('./route')).GET;
  }

  beforeEach(() => {
    delete process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;
    delete process.env.VIDEO_CACHE_MAX_AGE_SECONDS;
    mockAdminAuth.mockResolvedValue({ user: { id: 'a1', organizationUserId: 'ou-1' } });
    mockCourseFindUnique.mockResolvedValue(makeCourse({ createdByOrgUserId: 'someone-else' }));
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'e1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('costs ZERO Prisma queries and ZERO signings once warm', async () => {
    const get = await loadRoute();
    const fetchMock = vi.fn().mockResolvedValue(new Response('bytes', { status: 206 }));
    vi.stubGlobal('fetch', fetchMock);

    await get(makeReq(), { params });
    expect(mockCourseFindUnique).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 8; i++) {
      const res = await get(makeReq(), { params });
      expect(res.status).toBe(206);
    }

    expect(mockCourseFindUnique).toHaveBeenCalledTimes(1);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it('mints the signed URL for the raised 3600s expiry', async () => {
    const get = await loadRoute();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));

    await get(makeReq(), { params });

    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      'minio://lms-documents/system/videos/preview.mp4',
      3600,
    );
  });

  it('never caches a 403', async () => {
    const get = await loadRoute();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bytes', { status: 206 })));
    mockEnrollmentFindFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'e1' });

    expect((await get(makeReq(), { params })).status).toBe(403);
    expect((await get(makeReq(), { params })).status).toBe(206);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledTimes(2);
  });
});

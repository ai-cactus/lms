import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockLessonFindUnique,
  mockLessonUpdateMany,
  mockResolvePlaybackUrl,
  mockResolveVideoSource,
} = vi.hoisted(() => {
  const mockResolvePlaybackUrl = vi.fn();
  return {
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockLessonFindUnique: vi.fn(),
    mockLessonUpdateMany: vi.fn(),
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
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/video', () => ({
  resolveVideoSource: (provider: string) => mockResolveVideoSource(provider),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { GET } from './route';

const makeReq = (range?: string) =>
  new Request('http://localhost/api/video/lesson-1', {
    headers: range ? { range } : {},
  });
const params = Promise.resolve({ lessonId: 'lesson-1' });

const makeLesson = (opts?: {
  createdBy?: string;
  enrollments?: { id: string }[];
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
    enrollments: opts?.enrollments ?? [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockResolvePlaybackUrl.mockResolvedValue('http://minio:9000/lms-documents/system/videos/v.mp4');
  mockLessonUpdateMany.mockResolvedValue({ count: 1 });
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
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'someone', enrollments: [] }));
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(403);
    expect(mockResolveVideoSource).not.toHaveBeenCalled();
  });

  it('404 when the lesson has no video', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ enrollments: [{ id: 'e1' }], videoStorageUri: null }),
    );
    const res = await GET(makeReq(), { params });
    expect(res.status).toBe(404);
  });

  it('proxies the stream, forwards Range, and passes through storage headers', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'e1' }] }));

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
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ enrollments: [{ id: 'e1' }], videoProvider: null }),
    );
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
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'e1' }] }));
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

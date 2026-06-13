import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockLessonFindUnique,
  mockResolvePlaybackUrl,
  mockResolveVideoSource,
} = vi.hoisted(() => {
  const mockResolvePlaybackUrl = vi.fn();
  return {
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockLessonFindUnique: vi.fn(),
    mockResolvePlaybackUrl,
    mockResolveVideoSource: vi.fn<
      (provider: string) => { resolvePlaybackUrl: typeof mockResolvePlaybackUrl }
    >(() => ({ resolvePlaybackUrl: mockResolvePlaybackUrl })),
  };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { lesson: { findUnique: (...a: unknown[]) => mockLessonFindUnique(...a) } },
}));
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

/**
 * Contract for the course thumbnail route — the image every course list draws
 * for a video course.
 *
 * Authorization mirrors /api/courses/[id]/preview-poster exactly. The system
 * back office previews through /api/system/video-courses/[courseId]/thumbnail.
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
import { invalidateCourseThumbnailMeta } from '@/lib/video/playback-cache';

const CUSTOM_URI = 'gcs://lms/system/videos/thumbnails/c/1-custom.jpg';
const PREVIEW_URI = 'gcs://lms/system/videos/posters/2-preview.jpg';
const LESSON_URI = 'gcs://lms/system/videos/posters/3-lesson.jpg';

const ORIGINAL_TTL = process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;

let courseSeq = 0;
function nextCourseId(): string {
  courseSeq += 1;
  return `thumb-course-${courseSeq}`;
}

const makeReq = () => new Request('http://localhost/api/courses/x/thumbnail?v=1');
const call = (id: string) => GET(makeReq(), { params: Promise.resolve({ id }) });

const makeCourse = (
  opts: {
    thumbnailStorageUri?: string | null;
    previewPosterStorageUri?: string | null;
    lessonPoster?: string | null;
    isGlobal?: boolean;
    status?: string;
    type?: string;
    createdByOrgUserId?: string;
  } = {},
) => ({
  thumbnailStorageUri: opts.thumbnailStorageUri ?? null,
  previewPosterStorageUri: opts.previewPosterStorageUri ?? null,
  isGlobal: opts.isGlobal ?? true,
  status: opts.status ?? 'published',
  type: opts.type ?? 'video',
  createdByOrgUserId: opts.createdByOrgUserId ?? 'system-org-user',
  lessons: opts.lessonPoster === undefined ? [] : [{ videoPosterStorageUri: opts.lessonPoster }],
});

const signedFor = (uri: string) => `https://storage.example/${uri.split('/').pop()}?sig=1`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockSign.mockImplementation((uri: string) => Promise.resolve(signedFor(uri)));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('jpeg', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_TTL === undefined) delete process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;
  else process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = ORIGINAL_TTL;
});

const signIn = (organizationUserId = 'ou-1') =>
  mockAdminAuth.mockResolvedValue({ user: { id: 'u1', organizationUserId } });

describe('GET /api/courses/[id]/thumbnail — access', () => {
  it('401 without a portal session', async () => {
    const res = await call(nextCourseId());

    expect(res.status).toBe(401);
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('403 for a course the caller neither created nor is enrolled in, when it is not the global catalog', async () => {
    signIn('ou-outsider');
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ status: 'inactive', lessonPoster: LESSON_URI }),
    );

    const res = await call(nextCourseId());

    expect(res.status).toBe(403);
    expect(mockEnrollmentFindFirst).toHaveBeenCalledOnce();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('allows any signed-in user for the published global catalog without an enrollment lookup', async () => {
    signIn();
    mockCourseFindUnique.mockResolvedValue(makeCourse({ lessonPoster: LESSON_URI }));

    const res = await call(nextCourseId());

    expect(res.status).toBe(200);
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('allows an enrolled learner on a non-catalog course', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({ user: { id: 'w1', organizationUserId: 'ou-learner' } });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ status: 'inactive', lessonPoster: LESSON_URI }),
    );
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(200);
    expect(mockEnrollmentFindFirst.mock.calls[0][0].where).toMatchObject({
      organizationUserId: 'ou-learner',
    });
  });

  it('allows the course creator', async () => {
    signIn('ou-creator');
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ isGlobal: false, createdByOrgUserId: 'ou-creator', lessonPoster: LESSON_URI }),
    );

    const res = await call(nextCourseId());

    expect(res.status).toBe(200);
    expect(mockEnrollmentFindFirst).not.toHaveBeenCalled();
  });

  it('404 when the course does not exist', async () => {
    signIn();
    mockCourseFindUnique.mockResolvedValue(null);

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
  });
});

describe('GET /api/courses/[id]/thumbnail — source chain', () => {
  beforeEach(() => signIn());

  it('reads only the first lesson by order', async () => {
    mockCourseFindUnique.mockResolvedValue(makeCourse({ lessonPoster: LESSON_URI }));

    await call(nextCourseId());

    expect(mockCourseFindUnique.mock.calls[0][0].select.lessons).toEqual({
      orderBy: { order: 'asc' },
      take: 1,
      select: { videoPosterStorageUri: true },
    });
  });

  it.each([
    [
      'custom',
      {
        thumbnailStorageUri: CUSTOM_URI,
        previewPosterStorageUri: PREVIEW_URI,
        lessonPoster: LESSON_URI,
      },
      CUSTOM_URI,
    ],
    ['preview', { previewPosterStorageUri: PREVIEW_URI, lessonPoster: LESSON_URI }, PREVIEW_URI],
    ['lesson', { lessonPoster: LESSON_URI }, LESSON_URI],
  ])('serves the %s tier', async (_tier, opts, expectedUri) => {
    mockCourseFindUnique.mockResolvedValue(makeCourse(opts));

    const res = await call(nextCourseId());

    expect(res.status).toBe(200);
    expect(mockSign).toHaveBeenCalledWith(expectedUri, expect.any(Number));
    expect(fetch).toHaveBeenCalledWith(signedFor(expectedUri), expect.anything());
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(res.headers.get('vary')).toBe('Cookie');
  });

  it('404s without touching storage when nothing resolves', async () => {
    mockCourseFindUnique.mockResolvedValue(makeCourse({ lessonPoster: null }));

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('404s for a reading course even if it carries a poster', async () => {
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({
        type: 'text',
        isGlobal: false,
        createdByOrgUserId: 'ou-1',
        lessonPoster: LESSON_URI,
      }),
    );

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('serves the new tier after invalidateCourseThumbnailMeta', async () => {
    process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '60';
    const id = nextCourseId();
    mockCourseFindUnique.mockResolvedValueOnce(makeCourse({ lessonPoster: LESSON_URI }));
    await call(id);

    mockCourseFindUnique.mockResolvedValueOnce(
      makeCourse({ thumbnailStorageUri: CUSTOM_URI, lessonPoster: LESSON_URI }),
    );
    await call(id);
    // Warm: the second request did not re-read the row.
    expect(mockCourseFindUnique).toHaveBeenCalledTimes(1);

    invalidateCourseThumbnailMeta(id);
    await call(id);

    expect(mockCourseFindUnique).toHaveBeenCalledTimes(2);
    expect(mockSign).toHaveBeenLastCalledWith(CUSTOM_URI, expect.any(Number));
  });
});

/**
 * Contract for the course thumbnail route — the image every course list draws
 * for a video course.
 *
 * Authorization mirrors /api/courses/[id]/preview-poster, plus Q-15's org-admin
 * widening for retired/archived global video courses (thumbnail only). The
 * system back office previews through /api/system/video-courses/[courseId]/thumbnail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockFilteredCourseFindUnique,
  mockEnrollmentFindFirst,
  mockOfferingFindUnique,
  mockSign,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockFilteredCourseFindUnique: vi.fn(),
  mockEnrollmentFindFirst: vi.fn(),
  mockOfferingFindUnique: vi.fn(),
  mockSign: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
// The course row is read through `rawPrisma` (archive filter bypassed, Q-15);
// the filtered client gets its own spy so a swap back fails loudly.
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: (...a: unknown[]) => mockFilteredCourseFindUnique(...a) },
    enrollment: { findFirst: (...a: unknown[]) => mockEnrollmentFindFirst(...a) },
    orgCourseOffering: { findUnique: (...a: unknown[]) => mockOfferingFindUnique(...a) },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: { course: { findUnique: (...a: unknown[]) => mockCourseFindUnique(...a) } },
}));
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
    /** The course's OWNING organisation (RISK-15). */
    organizationId?: string;
    archivedAt?: Date | null;
  } = {},
) => ({
  thumbnailStorageUri: opts.thumbnailStorageUri ?? null,
  previewPosterStorageUri: opts.previewPosterStorageUri ?? null,
  isGlobal: opts.isGlobal ?? true,
  status: opts.status ?? 'published',
  type: opts.type ?? 'video',
  organizationId: opts.organizationId ?? 'org-system',
  archivedAt: opts.archivedAt ?? null,
  lessons: opts.lessonPoster === undefined ? [] : [{ videoPosterStorageUri: opts.lessonPoster }],
});

const signedFor = (uri: string) => `https://storage.example/${uri.split('/').pop()}?sig=1`;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentFindFirst.mockResolvedValue(null);
  mockOfferingFindUnique.mockResolvedValue(null);
  mockSign.mockImplementation((uri: string) => Promise.resolve(signedFor(uri)));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('jpeg', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_TTL === undefined) delete process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;
  else process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = ORIGINAL_TTL;
});

/** An admin of org-1 — the owning-org manager whenever a course is org-1's. */
const signIn = (organizationUserId = 'ou-1') =>
  mockAdminAuth.mockResolvedValue({
    user: { id: 'u1', organizationUserId, organizationId: 'org-1', role: 'admin' },
  });

describe('GET /api/courses/[id]/thumbnail — access', () => {
  it('401 without a portal session', async () => {
    const res = await call(nextCourseId());

    expect(res.status).toBe(401);
    expect(mockCourseFindUnique).not.toHaveBeenCalled();
  });

  it('403 for a course the caller neither manages nor is enrolled in, when it is not the global catalog', async () => {
    // A learner, so Q-15's org-admin widening (covered below) stays out of it.
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w1', organizationUserId: 'ou-outsider', organizationId: 'org-1', role: 'nurse' },
    });
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

  it('allows a manager of the organisation that owns the course', async () => {
    signIn('ou-manager');
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ isGlobal: false, organizationId: 'org-1', lessonPoster: LESSON_URI }),
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

describe('GET /api/courses/[id]/thumbnail — Q-15 org-admin widening', () => {
  const ARCHIVED_AT = new Date('2026-09-20T00:00:00Z');

  const signInOrgAdmin = (role = 'admin', organizationId = 'org-1') =>
    mockAdminAuth.mockResolvedValue({
      user: { id: 'u-admin', organizationUserId: 'ou-admin', organizationId, role },
    });

  it('reads the course through rawPrisma, never the archive-filtered client', async () => {
    signIn();
    mockCourseFindUnique.mockResolvedValue(makeCourse({ lessonPoster: LESSON_URI }));

    await call(nextCourseId());

    expect(mockCourseFindUnique).toHaveBeenCalledOnce();
    expect(mockFilteredCourseFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['retired (inactive)', { status: 'inactive' }],
    ['archived', { archivedAt: ARCHIVED_AT }],
  ])(
    'serves a %s global video course to an org admin whose org offered it',
    async (_label, opts) => {
      signInOrgAdmin();
      mockCourseFindUnique.mockResolvedValue(makeCourse({ ...opts, lessonPoster: LESSON_URI }));
      mockOfferingFindUnique.mockResolvedValue({ id: 'off-1' });
      const id = nextCourseId();

      const res = await call(id);

      expect(res.status).toBe(200);
      expect(mockOfferingFindUnique.mock.calls[0][0].where).toEqual({
        organizationId_courseId: { organizationId: 'org-1', courseId: id },
      });
    },
  );

  it('serves an archived global video course to an org admin whose org has an enrolment on it', async () => {
    signInOrgAdmin();
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ archivedAt: ARCHIVED_AT, lessonPoster: LESSON_URI }),
    );
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-org' });
    const id = nextCourseId();

    const res = await call(id);

    expect(res.status).toBe(200);
    expect(mockEnrollmentFindFirst.mock.calls[0][0].where).toEqual({
      courseId: id,
      organizationUser: { organizationId: 'org-1' },
    });
  });

  it('403s a retired course for an org admin whose org neither offered nor enrolled on it', async () => {
    signInOrgAdmin();
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ status: 'inactive', lessonPoster: LESSON_URI }),
    );

    const res = await call(nextCourseId());

    expect(res.status).toBe(403);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('keeps an archived course a 404 for an admin whose org has no tie to it', async () => {
    signInOrgAdmin();
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ archivedAt: ARCHIVED_AT, lessonPoster: LESSON_URI }),
    );

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
  });

  it("does not widen for Finance, which cannot see the organisation's courses", async () => {
    signInOrgAdmin('finance');
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ status: 'inactive', lessonPoster: LESSON_URI }),
    );
    mockOfferingFindUnique.mockResolvedValue({ id: 'off-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(403);
    expect(mockOfferingFindUnique).not.toHaveBeenCalled();
  });

  it('does not widen for a worker-portal session, even one enrolled elsewhere in the org', async () => {
    mockWorkerAuth.mockResolvedValue({
      user: {
        id: 'w1',
        organizationUserId: 'ou-w',
        organizationId: 'org-1',
        role: 'front_desk_admin',
      },
    });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ archivedAt: ARCHIVED_AT, lessonPoster: LESSON_URI }),
    );
    mockOfferingFindUnique.mockResolvedValue({ id: 'off-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
    expect(mockOfferingFindUnique).not.toHaveBeenCalled();
  });

  it('keeps an archived course a 404 for its own enrolled learner (the preview-poster rules never admit archived rows)', async () => {
    mockWorkerAuth.mockResolvedValue({ user: { id: 'w1', organizationUserId: 'ou-learner' } });
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ archivedAt: ARCHIVED_AT, lessonPoster: LESSON_URI }),
    );
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(404);
  });

  it('does not widen for an org-owned (non-global) retired course', async () => {
    signInOrgAdmin();
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ isGlobal: false, status: 'inactive', lessonPoster: LESSON_URI }),
    );
    mockOfferingFindUnique.mockResolvedValue({ id: 'off-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(403);
  });

  it('does not widen for a global, non-video (retired) course even when offered', async () => {
    signInOrgAdmin();
    mockCourseFindUnique.mockResolvedValue(
      makeCourse({ type: 'text', status: 'inactive', lessonPoster: LESSON_URI }),
    );
    mockOfferingFindUnique.mockResolvedValue({ id: 'off-1' });

    const res = await call(nextCourseId());

    expect(res.status).toBe(403);
    expect(mockOfferingFindUnique).not.toHaveBeenCalled();
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
        organizationId: 'org-1',
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

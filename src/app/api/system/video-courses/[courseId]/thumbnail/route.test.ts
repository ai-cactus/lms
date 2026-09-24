/**
 * /api/system/video-courses/[courseId]/thumbnail — GET is the back-office
 * preview; POST is the custom thumbnail upload.
 *
 * POST uses the real sharp so "undecodable" and "re-encoded to a ≤640px JPEG without
 * metadata" are proven against the actual codec, not a stub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import sharp from 'sharp';

const {
  mockVerifySystemAdmin,
  mockCourseFindFirst,
  mockCourseUpdate,
  mockUploadFile,
  mockDeleteFile,
  mockSign,
  mockRevalidatePath,
  mockRevalidateTag,
  mockInvalidateThumbnailMeta,
  mockLogger,
} = vi.hoisted(() => ({
  mockVerifySystemAdmin: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockCourseUpdate: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockSign: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRevalidateTag: vi.fn(),
  mockInvalidateThumbnailMeta: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/system-auth', () => ({ verifySystemAdminCookie: mockVerifySystemAdmin }));
vi.mock('@/lib/prisma', () => {
  const prisma = { course: { findFirst: mockCourseFindFirst, update: mockCourseUpdate } };
  return { prisma, default: prisma };
});
vi.mock('@/lib/storage', () => ({
  uploadFile: mockUploadFile,
  deleteFile: mockDeleteFile,
  getSignedUrl: mockSign,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
  revalidateTag: mockRevalidateTag,
}));
vi.mock('@/lib/video/playback-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/video/playback-cache')>()),
  invalidateCourseThumbnailMeta: mockInvalidateThumbnailMeta,
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import { GET, POST } from './route';

const COURSE_ID = 'course-1';
const PRIOR_CUSTOM = 'gcs://lms/system/videos/thumbnails/course-1/1-old.jpg';

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 140, b: 130 } },
  })
    .png()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-exif-marker' } } })
    .toBuffer();
}

function fileOf(bytes: Buffer | string, type: string, sizeOverride?: number): File {
  const file = new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], 'thumb', {
    type,
  });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeOverride, configurable: true });
  }
  return file;
}

function makeReq(entry: File | string | null): NextRequest {
  const form = new FormData();
  if (entry !== null) form.append('image', entry);
  return { formData: async () => form } as unknown as NextRequest;
}

const call = (req: NextRequest) => POST(req, { params: Promise.resolve({ courseId: COURSE_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySystemAdmin.mockResolvedValue(true);
  mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: null });
  mockCourseUpdate.mockResolvedValue({});
  mockUploadFile.mockImplementation((key: string) =>
    Promise.resolve({ storageUri: `gcs://lms/${key}` }),
  );
  mockDeleteFile.mockResolvedValue(undefined);
});

describe('POST /api/system/video-courses/[courseId]/thumbnail', () => {
  it('401 without the system-admin cookie, before reading anything', async () => {
    mockVerifySystemAdmin.mockResolvedValue(false);

    const res = await call(makeReq(fileOf(await png(10, 10), 'image/png')));

    expect(res.status).toBe(401);
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('404 for a course that is not a global video course', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    const res = await call(makeReq(fileOf(await png(10, 10), 'image/png')));

    expect(res.status).toBe(404);
    expect(mockCourseFindFirst.mock.calls[0][0].where).toEqual({
      id: COURSE_ID,
      type: 'video',
      isGlobal: true,
    });
  });

  it('400 when the image field is missing or not a file', async () => {
    expect((await call(makeReq(null))).status).toBe(400);
    expect((await call(makeReq('not-a-file'))).status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', ''])(
    '400 for a disallowed type (%s)',
    async (type) => {
      const res = await call(makeReq(fileOf(await png(10, 10), type)));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Image must be JPEG, PNG or WebP' });
      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    },
  );

  it('413 above the size cap', async () => {
    const res = await call(makeReq(fileOf(await png(10, 10), 'image/png', 5 * 1024 * 1024 + 1)));

    expect(res.status).toBe(413);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('400 for bytes that do not decode, whatever type they claim', async () => {
    const res = await call(makeReq(fileOf('definitely not an image', 'image/jpeg')));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The file is not a readable image' });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('re-encodes to a ≤640px JPEG without metadata, stores it under the course prefix and saves it', async () => {
    const res = await call(makeReq(fileOf(await png(1600, 900), 'image/png')));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ thumbnailSource: 'custom' });

    const [key, buffer, mime] = mockUploadFile.mock.calls[0] as [string, Buffer, string];
    expect(key).toMatch(/^system\/videos\/thumbnails\/course-1\/\d+-[0-9a-f-]+\.jpg$/);
    expect(mime).toBe('image/jpeg');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(640);
    expect(meta.exif).toBeUndefined();
    expect(buffer.includes('secret-exif-marker')).toBe(false);

    expect(mockCourseUpdate).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      data: { thumbnailStorageUri: `gcs://lms/${key}` },
    });
    expect(mockInvalidateThumbnailMeta).toHaveBeenCalledWith(COURSE_ID);
    expect(mockRevalidateTag).toHaveBeenCalledWith('video-catalog', { expire: 0 });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/system/video-courses/${COURSE_ID}/edit`);
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('does not enlarge a small image', async () => {
    await call(makeReq(fileOf(await png(200, 100), 'image/png')));

    const buffer = mockUploadFile.mock.calls[0][1] as Buffer;
    expect((await sharp(buffer).metadata()).width).toBe(200);
  });

  it('deletes the previous custom thumbnail after the new one is saved', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });

    const res = await call(makeReq(fileOf(await png(50, 50), 'image/png')));

    expect(res.status).toBe(201);
    expect(mockDeleteFile).toHaveBeenCalledWith(PRIOR_CUSTOM);
    expect(mockCourseUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteFile.mock.invocationCallOrder[0],
    );
  });

  it('never deletes a previous value outside the custom-thumbnail prefix', async () => {
    mockCourseFindFirst.mockResolvedValue({
      id: COURSE_ID,
      thumbnailStorageUri: 'gcs://lms/system/videos/posters/9-lesson.jpg',
    });

    const res = await call(makeReq(fileOf(await png(50, 50), 'image/png')));

    expect(res.status).toBe(201);
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('still succeeds when deleting the previous thumbnail fails', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });
    mockDeleteFile.mockRejectedValue(new Error('storage down'));

    const res = await call(makeReq(fileOf(await png(50, 50), 'image/png')));

    expect(res.status).toBe(201);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('502 when storage rejects the upload, without touching the row', async () => {
    mockUploadFile.mockRejectedValue(new Error('bucket unavailable'));

    const res = await call(makeReq(fileOf(await png(50, 50), 'image/png')));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Failed to store the image' });
    expect(mockCourseUpdate).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('500 and reclaims the new object when the DB write fails, leaving the old one', async () => {
    mockCourseFindFirst.mockResolvedValue({ id: COURSE_ID, thumbnailStorageUri: PRIOR_CUSTOM });
    mockCourseUpdate.mockRejectedValue(new Error('db down'));

    const res = await call(makeReq(fileOf(await png(50, 50), 'image/png')));

    expect(res.status).toBe(500);
    const newUri = `gcs://lms/${mockUploadFile.mock.calls[0][0]}`;
    await vi.waitFor(() => expect(mockDeleteFile).toHaveBeenCalledWith(newUri));
    expect(mockDeleteFile).not.toHaveBeenCalledWith(PRIOR_CUSTOM);
    expect(mockInvalidateThumbnailMeta).not.toHaveBeenCalled();
  });
});

describe('GET /api/system/video-courses/[courseId]/thumbnail', () => {
  const CUSTOM_URI = 'gcs://lms/system/videos/thumbnails/course-1/1-custom.jpg';
  const PREVIEW_URI = 'gcs://lms/system/videos/posters/2-preview.jpg';
  const LESSON_URI = 'gcs://lms/system/videos/posters/3-lesson.jpg';
  const ORIGINAL_TTL = process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;

  const signedFor = (uri: string) => `https://storage.example/${uri.split('/').pop()}?sig=1`;
  const get = () =>
    GET(new Request(`http://localhost/api/system/video-courses/${COURSE_ID}/thumbnail?v=1`), {
      params: Promise.resolve({ courseId: COURSE_ID }),
    });

  const row = (
    opts: {
      thumbnailStorageUri?: string | null;
      previewPosterStorageUri?: string | null;
      lessonPoster?: string | null;
    } = {},
  ) => ({
    type: 'video',
    thumbnailStorageUri: opts.thumbnailStorageUri ?? null,
    previewPosterStorageUri: opts.previewPosterStorageUri ?? null,
    lessons: opts.lessonPoster === undefined ? [] : [{ videoPosterStorageUri: opts.lessonPoster }],
  });

  beforeEach(() => {
    // Disables the signed-URL cache so each case signs its own URI.
    process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
    mockSign.mockImplementation((uri: string) => Promise.resolve(signedFor(uri)));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('jpeg', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_TTL === undefined) delete process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS;
    else process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = ORIGINAL_TTL;
  });

  it('401 without the system-admin cookie, before reading anything', async () => {
    mockVerifySystemAdmin.mockResolvedValue(false);

    const res = await get();

    expect(res.status).toBe(401);
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('404 for a course that is not a global video course, reading as the edit page does', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(404);
    const query = mockCourseFindFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: COURSE_ID, type: 'video', isGlobal: true });
    expect(query.select.lessons).toEqual({
      orderBy: { order: 'asc' },
      take: 1,
      select: { videoPosterStorageUri: true },
    });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('does not filter on status, so drafts and retired courses are previewable', async () => {
    mockCourseFindFirst.mockResolvedValue(row({ thumbnailStorageUri: CUSTOM_URI }));

    const res = await get();

    expect(res.status).toBe(200);
    expect(mockCourseFindFirst.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('404 without touching storage when no thumbnail resolves', async () => {
    mockCourseFindFirst.mockResolvedValue(row({ lessonPoster: null }));

    const res = await get();

    expect(res.status).toBe(404);
    expect(mockSign).not.toHaveBeenCalled();
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
  ])('streams the %s tier with no-store caching', async (_tier, opts, expectedUri) => {
    mockCourseFindFirst.mockResolvedValue(row(opts));

    const res = await get();

    expect(res.status).toBe(200);
    expect(mockSign).toHaveBeenCalledWith(expectedUri, expect.any(Number));
    expect(fetch).toHaveBeenCalledWith(signedFor(expectedUri), expect.anything());
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('jpeg');
  });

  it('keeps no-store on a 304 revalidation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
    mockCourseFindFirst.mockResolvedValue(row({ lessonPoster: LESSON_URI }));

    const res = await get();

    expect(res.status).toBe(304);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

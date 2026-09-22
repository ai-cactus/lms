import { describe, it, expect } from 'vitest';
import {
  CUSTOM_THUMBNAIL_KEY_PREFIX,
  buildCourseThumbnailUrl,
  buildSystemCourseThumbnailUrl,
  isCustomThumbnailStorageUri,
  resolveCourseThumbnailSource,
  resolveCourseThumbnailStorageUri,
  type CourseThumbnailInputs,
} from './thumbnail';

const CUSTOM = 'gcs://lms/system/videos/thumbnails/c1/1-a.jpg';
const PREVIEW = 'gcs://lms/system/videos/posters/2-b.jpg';
const LESSON = 'minio://lms/system/videos/posters/3-c.jpg';

const inputs = (overrides: Partial<CourseThumbnailInputs> = {}): CourseThumbnailInputs => ({
  type: 'video',
  thumbnailStorageUri: CUSTOM,
  previewPosterStorageUri: PREVIEW,
  firstLessonPosterStorageUri: LESSON,
  ...overrides,
});

describe('resolveCourseThumbnailSource / resolveCourseThumbnailStorageUri', () => {
  it.each([
    ['custom wins over every poster', inputs(), 'custom', CUSTOM],
    ['preview poster when no custom', inputs({ thumbnailStorageUri: null }), 'preview', PREVIEW],
    [
      'lesson poster when no custom and no preview',
      inputs({ thumbnailStorageUri: null, previewPosterStorageUri: undefined }),
      'lesson',
      LESSON,
    ],
    [
      'none when the chain is empty',
      inputs({
        thumbnailStorageUri: null,
        previewPosterStorageUri: null,
        firstLessonPosterStorageUri: null,
      }),
      'none',
      null,
    ],
    [
      'empty strings count as absent',
      inputs({ thumbnailStorageUri: '', previewPosterStorageUri: '' }),
      'lesson',
      LESSON,
    ],
  ])('%s', (_label, input, source, uri) => {
    expect(resolveCourseThumbnailSource(input)).toBe(source);
    expect(resolveCourseThumbnailStorageUri(input)).toBe(uri);
  });

  it.each(['text', null, undefined, 'VIDEO'])(
    'a non-video course (%s) is always none, whatever it stores',
    (type) => {
      expect(resolveCourseThumbnailSource(inputs({ type }))).toBe('none');
      expect(resolveCourseThumbnailStorageUri(inputs({ type }))).toBeNull();
    },
  );
});

describe('isCustomThumbnailStorageUri', () => {
  it('accepts an object under the custom prefix on either backend', () => {
    expect(isCustomThumbnailStorageUri(CUSTOM)).toBe(true);
    expect(
      isCustomThumbnailStorageUri(`minio://other-bucket/${CUSTOM_THUMBNAIL_KEY_PREFIX}x.jpg`),
    ).toBe(true);
  });

  it.each([
    ['a preview poster', PREVIEW],
    ['a lesson poster', LESSON],
    ['a course video', 'gcs://lms/system/videos/1-video.mp4'],
    ['the prefix appearing only in the bucket name', 'gcs://system/videos/thumbnails/x.jpg'],
    ['a path-traversal key', 'gcs://lms/system/videos/thumbnails/../posters/x.jpg'],
    ['a legacy local path', '/uploads/system/videos/thumbnails/x.jpg'],
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('rejects %s', (_label, uri) => {
    expect(isCustomThumbnailStorageUri(uri)).toBe(false);
  });
});

describe('buildCourseThumbnailUrl', () => {
  const course = {
    id: 'course-1',
    type: 'video',
    thumbnailStorageUri: null,
    previewPosterStorageUri: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const lesson = {
    videoPosterStorageUri: LESSON,
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  };

  it('returns the versioned route URL, never the storage URI', () => {
    const url = buildCourseThumbnailUrl(course, lesson);

    expect(url).toBe(`/api/courses/course-1/thumbnail?v=${lesson.updatedAt.getTime()}`);
    expect(url).not.toContain('minio://');
  });

  it('versions by the newer of the course and first-lesson timestamps', () => {
    const newerCourse = { ...course, updatedAt: new Date('2026-09-20T00:00:00.000Z') };

    expect(buildCourseThumbnailUrl(newerCourse, lesson)).toBe(
      `/api/courses/course-1/thumbnail?v=${newerCourse.updatedAt.getTime()}`,
    );
  });

  it('accepts ISO strings, as the cached catalog stores them', () => {
    const url = buildCourseThumbnailUrl(
      { ...course, thumbnailStorageUri: CUSTOM, updatedAt: '2026-09-01T00:00:00.000Z' },
      null,
    );

    expect(url).toBe(`/api/courses/course-1/thumbnail?v=${Date.parse('2026-09-01T00:00:00.000Z')}`);
  });

  it('is null when nothing resolves, so the list draws its placeholder', () => {
    expect(buildCourseThumbnailUrl(course, null)).toBeNull();
    expect(buildCourseThumbnailUrl(course, { ...lesson, videoPosterStorageUri: null })).toBeNull();
  });

  it('is null for a reading course even with a poster', () => {
    expect(buildCourseThumbnailUrl({ ...course, type: 'text' }, lesson)).toBeNull();
  });

  it('encodes the course id', () => {
    expect(buildCourseThumbnailUrl({ ...course, id: 'a/b' }, lesson)).toMatch(
      /^\/api\/courses\/a%2Fb\/thumbnail\?v=/,
    );
  });
});

describe('buildSystemCourseThumbnailUrl', () => {
  const course = {
    id: 'course-1',
    type: 'video',
    thumbnailStorageUri: CUSTOM,
    previewPosterStorageUri: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const lesson = {
    videoPosterStorageUri: LESSON,
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
  };

  it('points at the system route with the same version as the list URL', () => {
    const url = buildSystemCourseThumbnailUrl(course, lesson);

    expect(url).toBe(
      `/api/system/video-courses/course-1/thumbnail?v=${lesson.updatedAt.getTime()}`,
    );
    expect(url?.split('?v=')[1]).toBe(buildCourseThumbnailUrl(course, lesson)?.split('?v=')[1]);
  });

  it('is null when nothing resolves', () => {
    expect(
      buildSystemCourseThumbnailUrl({ ...course, thumbnailStorageUri: null }, null),
    ).toBeNull();
  });

  it('encodes the course id', () => {
    expect(buildSystemCourseThumbnailUrl({ ...course, id: 'a/b' }, null)).toMatch(
      /^\/api\/system\/video-courses\/a%2Fb\/thumbnail\?v=/,
    );
  });
});

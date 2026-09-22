/**
 * Which still a video course's thumbnail is served from.
 *
 * Pure and dependency-free so the serving routes, the course-list DTOs and the
 * system edit page all resolve the same answer. The chain, most specific first:
 *
 *  1. `custom`  — `Course.thumbnailStorageUri`, set by a system admin (an
 *     uploaded image, or a frame regenerated from the course video).
 *  2. `preview` — `Course.previewPosterStorageUri`, the still of the optional
 *     preview video.
 *  3. `lesson`  — the first lesson's `videoPosterStorageUri`, the still of the
 *     course video itself.
 *  4. `none`    — nothing to show; the UI draws its placeholder.
 *
 * Reading courses always resolve to `none`: their row artwork is the design's
 * fixed reading glyph, never a stored image.
 */

export type CourseThumbnailSource = 'custom' | 'preview' | 'lesson' | 'none';

export interface CourseThumbnailInputs {
  type: string | null | undefined;
  thumbnailStorageUri: string | null | undefined;
  previewPosterStorageUri: string | null | undefined;
  firstLessonPosterStorageUri: string | null | undefined;
}

/** Object-key prefix for admin-chosen thumbnails, uploaded or regenerated. */
export const CUSTOM_THUMBNAIL_KEY_PREFIX = 'system/videos/thumbnails/';

export function resolveCourseThumbnailSource(inputs: CourseThumbnailInputs): CourseThumbnailSource {
  if (inputs.type !== 'video') return 'none';
  if (inputs.thumbnailStorageUri) return 'custom';
  if (inputs.previewPosterStorageUri) return 'preview';
  if (inputs.firstLessonPosterStorageUri) return 'lesson';
  return 'none';
}

export function resolveCourseThumbnailStorageUri(inputs: CourseThumbnailInputs): string | null {
  switch (resolveCourseThumbnailSource(inputs)) {
    case 'custom':
      return inputs.thumbnailStorageUri ?? null;
    case 'preview':
      return inputs.previewPosterStorageUri ?? null;
    case 'lesson':
      return inputs.firstLessonPosterStorageUri ?? null;
    case 'none':
      return null;
  }
}

/**
 * True when `storageUri` names an object this feature wrote under
 * {@link CUSTOM_THUMBNAIL_KEY_PREFIX}. Only such an object may be deleted when a
 * custom thumbnail is replaced or removed — a preview or lesson poster is owned
 * by its video and must survive.
 *
 * Matches on the key, after the `<scheme>://<bucket>/` head, so neither the
 * backend nor the bucket name matters.
 */
export function isCustomThumbnailStorageUri(
  storageUri: string | null | undefined,
): storageUri is string {
  if (!storageUri) return false;
  const match = /^[a-z]+:\/\/[^/]+\/(.+)$/.exec(storageUri);
  if (!match) return false;
  const key = match[1];
  return key.startsWith(CUSTOM_THUMBNAIL_KEY_PREFIX) && !key.includes('..');
}

export interface CourseThumbnailCourseRow {
  id: string;
  type: string | null | undefined;
  thumbnailStorageUri: string | null | undefined;
  previewPosterStorageUri: string | null | undefined;
  updatedAt: Date | string;
}

export interface CourseThumbnailLessonRow {
  videoPosterStorageUri: string | null | undefined;
  updatedAt: Date | string;
}

function toMillis(value: Date | string): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The `v` cache-buster for a thumbnail route URL, or null when there is nothing
 * to show.
 *
 * The route path is stable while the object behind it is not, so `v` carries
 * the latest write that could have changed the answer: every custom-thumbnail
 * write and preview repoint bumps `Course.updatedAt`, and a transcode landing a
 * new lesson poster bumps the lesson's.
 *
 * `firstLesson` must be the lesson with the lowest `order`, i.e. the course
 * video — the same one the routes resolve.
 */
function thumbnailVersion(
  course: CourseThumbnailCourseRow,
  firstLesson: CourseThumbnailLessonRow | null | undefined,
): number | null {
  const source = resolveCourseThumbnailSource({
    type: course.type,
    thumbnailStorageUri: course.thumbnailStorageUri,
    previewPosterStorageUri: course.previewPosterStorageUri,
    firstLessonPosterStorageUri: firstLesson?.videoPosterStorageUri,
  });
  if (source === 'none') return null;

  return Math.max(toMillis(course.updatedAt), firstLesson ? toMillis(firstLesson.updatedAt) : 0);
}

/**
 * The same-origin URL a course list hands to `CourseThumbnail`, or null when
 * there is nothing to show (the component then draws its placeholder). Posters
 * are served `immutable`, so the version in `v` is what makes a change visible.
 * Never a storage URI — those must not reach the browser.
 */
export function buildCourseThumbnailUrl(
  course: CourseThumbnailCourseRow,
  firstLesson: CourseThumbnailLessonRow | null | undefined,
): string | null {
  const version = thumbnailVersion(course, firstLesson);
  if (version === null) return null;
  return `/api/courses/${encodeURIComponent(course.id)}/thumbnail?v=${version}`;
}

/**
 * The back-office preview URL for the same thumbnail. The /system edit page has
 * no portal session, so it cannot use the portal-authenticated route above; the
 * system route is gated by the system-admin cookie and served `no-store`.
 */
export function buildSystemCourseThumbnailUrl(
  course: CourseThumbnailCourseRow,
  firstLesson: CourseThumbnailLessonRow | null | undefined,
): string | null {
  const version = thumbnailVersion(course, firstLesson);
  if (version === null) return null;
  return `/api/system/video-courses/${encodeURIComponent(course.id)}/thumbnail?v=${version}`;
}

/**
 * The Prisma `lessons` sub-select every list uses to feed
 * {@link buildCourseThumbnailUrl} — one ordered row per course, so the lists
 * stay a single query rather than one per course.
 */
export const firstLessonThumbnailSelect = {
  orderBy: { order: 'asc' },
  take: 1,
  select: { videoPosterStorageUri: true, updatedAt: true },
} as const;

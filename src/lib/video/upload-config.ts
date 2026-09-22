/**
 * Shared video-upload limits.
 *
 * Imported by BOTH the direct-to-GCS signed-URL route
 * (`/api/system/video-courses/upload-url`) and the legacy proxy fallback
 * route (`/api/system/video-courses/upload`) so the two paths enforce an
 * identical contract. The client also enforces MAX_VIDEO_BYTES before it
 * even requests an upload URL.
 */

export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES ?? 500 * 1024 * 1024);

export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;

export type AllowedVideoType = (typeof ALLOWED_VIDEO_TYPES)[number];

/**
 * Custom video-course thumbnail uploads (`/api/system/video-courses/[courseId]/thumbnail`).
 * The route re-encodes every accepted image to a ≤640px JPEG, so the cap only
 * bounds what the server has to decode.
 */
export const MAX_THUMBNAIL_UPLOAD_BYTES = Number(
  process.env.MAX_THUMBNAIL_UPLOAD_BYTES ?? 5 * 1024 * 1024,
);

export const ALLOWED_THUMBNAIL_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Matches the width video posters are extracted at (POSTER_WIDTH in encoding.ts). */
export const THUMBNAIL_MAX_WIDTH = 640;

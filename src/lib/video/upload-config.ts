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

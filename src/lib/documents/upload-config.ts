/**
 * Shared document-upload limits.
 *
 * Mirrors the video-upload config pattern (`src/lib/video/upload-config.ts`).
 * Lives in its own module (rather than inside a server-action file) because
 * `'use server'` modules may only export async functions — both the
 * Document-Hub upload path (`uploadDocument`) and the course-wizard file path
 * (`generateCourseAndQuizV46`) import this constant so the two entry points
 * enforce an identical size cap before buffering/parsing untrusted uploads.
 */

// Default 25 MB. Overridable via env without a redeploy.
export const MAX_DOCUMENT_UPLOAD_BYTES = Number(
  process.env.MAX_DOCUMENT_UPLOAD_BYTES ?? 25 * 1024 * 1024,
);

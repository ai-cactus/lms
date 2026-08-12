/**
 * Response-header rules shared by the two video proxies
 * (`/api/video/[lessonId]` and `/api/courses/[id]/preview-video`).
 *
 * Both used to default `content-type` to `video/mp4` and `accept-ranges` to
 * `bytes` unconditionally whenever upstream omitted them. Both defaults were
 * wrong in a reachable case, and both broke iOS specifically — see the two
 * functions below. Keeping them here rather than duplicating them per route is
 * deliberate: the rules are subtle enough that two copies would drift.
 */

import type { AllowedVideoType } from '@/lib/video/upload-config';

const EXTENSION_TYPES: Record<string, AllowedVideoType> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * The content type implied by a storage URI's file extension, or `null` when the
 * extension is absent or unrecognised.
 *
 * `null` means "say nothing". Omitting the header lets the browser sniff the
 * container, which beats asserting a type that may be wrong: `ALLOWED_VIDEO_TYPES`
 * in `upload-config.ts` accepts `video/webm`, and `actions/video-course.ts`
 * deliberately keeps the RAW upload playable when the transcode never ran — so a
 * VP8/VP9 WebM served as `video/mp4` is a real outcome, and iOS then refuses to
 * play it while reporting a MIME type that sends whoever debugs it the wrong way.
 */
export function videoContentTypeFromStorageUri(storageUri: string): AllowedVideoType | null {
  // Query strings and fragments are not part of the object key but do survive
  // into some signed URLs, so strip them before looking at the extension.
  const path = storageUri.split(/[?#]/, 1)[0];
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return null;

  return EXTENSION_TYPES[lastSegment.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Fills in `content-type` and `accept-ranges` on a proxied media response,
 * mutating `headers` in place. Anything upstream already sent has been copied in
 * by the caller and is left untouched.
 *
 * `accept-ranges: bytes` is added ONLY to a 206. On a 200 the upstream either
 * advertised range support itself (already passed through) or it did not — and
 * a 200 answering a Range request means it could not honour one. Advertising
 * range support the proxy just failed to provide makes iOS keep issuing range
 * requests that each return the entire file.
 */
export function applyProxiedMediaHeaders(
  headers: Headers,
  upstreamStatus: number,
  storageUri: string,
): void {
  if (!headers.has('content-type')) {
    const contentType = videoContentTypeFromStorageUri(storageUri);
    if (contentType) headers.set('content-type', contentType);
  }
  if (upstreamStatus === 206 && !headers.has('accept-ranges')) {
    headers.set('accept-ranges', 'bytes');
  }
}

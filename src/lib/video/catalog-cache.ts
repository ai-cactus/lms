import { revalidateTag } from 'next/cache';

/** Tag carried by the cached global video catalog (see actions/offering.ts). */
export const VIDEO_CATALOG_TAG = 'video-catalog';

/**
 * Expires the cached global video catalog so the next read recomputes it.
 *
 * `revalidateTag(tag, 'max')` only marks the entry stale: Next keeps serving
 * the old catalog for the profile's `expire` window while it revalidates in
 * the background, so the admin who just published or renamed a course can
 * still be shown the previous list. `{ expire: 0 }` is Next's documented form
 * for immediate expiration — the next request is a cache miss.
 *
 * `updateTag` would be the Server-Action equivalent, but it throws (E872) in a
 * Route Handler, and two of these callers reach here through one
 * (`/api/system/video-courses` and the thumbnail upload route).
 */
export function expireVideoCatalog(): void {
  revalidateTag(VIDEO_CATALOG_TAG, { expire: 0 });
}

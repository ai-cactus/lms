import { getSignedUrl } from '@/lib/storage';
import { applyPosterCacheHeaders, resolveSignedPlaybackUrl } from './playback-cache';
import { logger } from '@/lib/logger';

/**
 * Streams a poster image back over same-origin HTTPS.
 *
 * Shared by /api/video/[lessonId]/poster and /api/courses/[id]/preview-poster,
 * which differ only in how they look up and authorize the storage URI — the
 * fetch, the header policy and the abort handling below are identical, and a
 * poster served with a different cache policy on one of the two routes would be
 * a silent regression on whichever page uses it.
 *
 * The browser can't use the storage signed URL directly for the same reason the
 * video proxies exist (MinIO presigns against the internal Docker host over
 * plain http), so the URL is resolved server-side and the bytes are relayed.
 */

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified'] as const;

/** A 304 carries no body and no entity headers — only the validators. */
const NOT_MODIFIED_HEADERS = ['etag', 'last-modified'] as const;

/**
 * Posters are cached `immutable` for a day, so a browser only revalidates once
 * the entry ages out. Forwarding the validators makes that revalidation a header
 * exchange instead of a re-download.
 */
const FORWARDED_REQUEST_HEADERS = ['If-None-Match', 'If-Modified-Since'] as const;

/** True when a fetch rejected because the caller's connection went away. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function forwardedRequestHeaders(request: Request): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwarded[name] = value;
  }
  return forwarded;
}

export async function streamPoster(
  request: Request,
  storageUri: string,
  logContext: Record<string, string>,
): Promise<Response> {
  let signedUrl: string;
  try {
    signedUrl = await resolveSignedPlaybackUrl(storageUri, (expirySeconds) =>
      getSignedUrl(storageUri, expirySeconds),
    );
  } catch (err) {
    logger.error({ msg: '[poster-proxy] failed to resolve poster url', err, ...logContext });
    return new Response('Failed to resolve poster', { status: 500 });
  }

  let upstream: Response;
  try {
    // `signal` ties the upstream read to the browser's connection: a catalog
    // page that navigates away mid-load cancels a dozen of these at once.
    upstream = await fetch(signedUrl, {
      headers: forwardedRequestHeaders(request),
      signal: request.signal,
    });
  } catch (err) {
    // A client-cancelled image load is routine, not a failure.
    if (isAbortError(err)) return new Response(null, { status: 499 });
    logger.error({ msg: '[poster-proxy] failed to fetch from storage', err, ...logContext });
    return new Response('Failed to fetch poster from storage', { status: 502 });
  }

  if (upstream.status === 304) {
    const notModifiedHeaders = new Headers();
    for (const h of NOT_MODIFIED_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) notModifiedHeaders.set(h, v);
    }
    applyPosterCacheHeaders(notModifiedHeaders);
    return new Response(null, { status: 304, headers: notModifiedHeaders });
  }

  if (!upstream.ok) {
    // Never persist a "media missing" verdict from a poster miss — the video
    // itself may be perfectly fine, and the consumers degrade to a placeholder.
    logger.error({
      msg: '[poster-proxy] storage error fetching poster',
      status: upstream.status,
      ...logContext,
    });
    return new Response('Failed to fetch poster from storage', { status: upstream.status });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'image/jpeg');
  applyPosterCacheHeaders(headers);

  return new Response(upstream.body, { status: upstream.status, headers });
}

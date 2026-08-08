/**
 * Short-TTL caching policy for the video proxy hot path
 * (`/api/video/[lessonId]` and `/api/courses/[id]/preview-video`).
 *
 * A `<video>` element issues one Range request per buffer window and several
 * more per seek, so a single lesson playback drives dozens of hits at these
 * routes. Before this module every one of them paid a `lesson.findUnique`,
 * sometimes an `enrollment.findFirst`, and a fresh GCS V4 RSA signature before
 * a byte moved. Three caches collapse a warm playback to zero Postgres queries
 * and zero signatures.
 *
 * IN-PROCESS ONLY — deliberately no Redis. This app runs as exactly ONE
 * container per environment (`docker-compose.production.yml`; no pm2 cluster,
 * no replicas), so a plain in-process map is ~100% effective and a Redis tier
 * would only add a network hop plus JSON serialisation for nothing. Revisit
 * this the moment the app is scaled horizontally, or a dedicated worker service
 * is split out of the web container — at that point each instance would hold
 * its own partial view and an L2 in Redis starts to earn its keep.
 *
 * IMPORTANT — this is a *revocation-latency* trade, not a correctness change,
 * exactly as accepted for `session-revalidation-cache.ts`:
 *  - Only an ALLOW is ever cached; a DENY never is. Caching a deny would give a
 *    learner who just enrolled a sticky 403 for the whole TTL — a visible bug —
 *    whereas caching an allow merely lets a revoked enrollment keep playing for
 *    at most the authz TTL (default 300s).
 *  - Authz is keyed on the COURSE, not the lesson, so one invalidation at
 *    unenroll covers every lesson in that course.
 *  - The URL cache is keyed by `storageUri`, so repointing a lesson at a new
 *    object naturally lands on a fresh key. There is no stale-URL failure mode;
 *    only the meta cache needs eager invalidation on a repoint.
 *
 * Fail-safe by construction, mirroring `session-revalidation-cache.ts`:
 *  - Any internal cache error is swallowed and treated as a miss, so the caller
 *    falls through to the real query — never fail-closed, never throw out of
 *    the cache layer.
 *  - `VIDEO_PLAYBACK_CACHE_TTL_SECONDS=0` disables all three caches, restoring
 *    byte-identical pre-cache behavior with no rebuild.
 *
 * Only non-sensitive playback routing data is stored: storage URIs, course
 * visibility flags, a boolean allow, and the signed URL itself — which in this
 * architecture is server-side only and is never sent to the browser (the client
 * only ever sees the relative `/api/video/<lessonId>` proxy path).
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';

const DEFAULT_TTL_SECONDS = 60;
const AUTHZ_TTL_SECONDS = 300;

/**
 * How long a minted storage signed URL stays valid. Raised from the previous
 * 900s because the URL is resolved server-side and streamed through the proxy —
 * it is never handed to the browser — so a longer mint window carries no
 * exposure, and it is what lets the URL cache hold an entry for 2400s.
 */
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;
const MIN_SIGNED_URL_TTL_SECONDS = 60;
/** GCS V4 signing refuses anything beyond 7 days. */
const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Default `max-age` for lesson video responses. */
export const LESSON_VIDEO_MAX_AGE_SECONDS = 900;
/**
 * Preview videos serve the global published catalog — the same bytes for every
 * viewer, and replaced by repointing to a new object rather than mutating in
 * place — so they tolerate a much longer browser cache.
 */
export const PREVIEW_VIDEO_MAX_AGE_SECONDS = 3600;

/**
 * Entry caps. The container runs under a 1 GB memory limit, so none of these
 * maps may grow unbounded. Sizing is deliberately ~10x the realistic live
 * working set (the catalog is a few hundred videos, and only what is actively
 * being watched within a 60s window can be resident):
 *  - meta: ~300 B/entry (two URIs + six course scalars) → ~300 KB at cap.
 *  - authz: ~100 B/entry (two ids + a timestamp) → ~500 KB at cap; the cap is
 *    higher because the key is per (user, course) and so is the most numerous.
 *  - url: GCS V4 signed URLs run ~1 KB → ~1 MB at cap.
 * Worst case across all three is under ~2 MB, which is noise against 1 GB.
 */
const META_MAX_ENTRIES = 1000;
const AUTHZ_MAX_ENTRIES = 5000;
const URL_MAX_ENTRIES = 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * A bounded, TTL-expiring map.
 *
 * Eviction is insertion-order FIFO rather than LRU: `Map` already preserves
 * insertion order, so the oldest key is free to find, and with a 60–300s TTL
 * the difference between FIFO and LRU is immaterial — entries age out long
 * before the cap is the binding constraint in normal operation. The cap exists
 * as a memory backstop, not as a hit-rate optimisation.
 */
class BoundedTtlCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.evict();
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}

const metaCache = new BoundedTtlCache(META_MAX_ENTRIES);
const authzCache = new BoundedTtlCache(AUTHZ_MAX_ENTRIES);
const urlCache = new BoundedTtlCache(URL_MAX_ENTRIES);

/**
 * De-duplicates concurrent loads of the same key. Chrome opens several Range
 * requests in parallel on a cold key; without this each would run its own query
 * and its own RSA sign, which is precisely the burst this module exists to
 * absorb. Keys are fully qualified (`meta:lesson:…`, `authz:…`, `url:…`) so the
 * three caches share one flight map without colliding.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Resolve the cache TTL at call time so ops can tune it via env without a
 * rebuild. Non-numeric or negative values fall back to the default; `0`
 * disables all three caches (callers then always hit the real query).
 */
export function getPlaybackCacheTtlSeconds(): number {
  return readNonNegativeInt(process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);
}

/**
 * The expiry requested when minting a storage signed URL. Clamped to the range
 * the signers accept so a malformed env value can never produce an unsignable
 * or immediately-expired URL.
 */
export function getSignedUrlTtlSeconds(): number {
  const raw = readNonNegativeInt(
    process.env.VIDEO_SIGNED_URL_TTL_SECONDS,
    DEFAULT_SIGNED_URL_TTL_SECONDS,
  );
  return Math.min(Math.max(raw, MIN_SIGNED_URL_TTL_SECONDS), MAX_SIGNED_URL_TTL_SECONDS);
}

/**
 * How long a minted URL may be reused. Two thirds of the mint TTL leaves a full
 * third of the window as headroom, so a cached URL always has ample validity
 * left when it is handed to the upstream fetch.
 */
function getSignedUrlCacheTtlSeconds(): number {
  return Math.max(60, Math.floor((getSignedUrlTtlSeconds() * 2) / 3));
}

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Cache-aside read with single-flight, used by every `resolve*` below.
 *
 * `shouldCache` is what implements the cache-the-allow-never-the-deny rule: a
 * value it rejects (a missing lesson, a denied authz) is returned to the caller
 * but never stored, so the next request re-reads the truth.
 *
 * A cache read/write fault degrades to a direct `load()` — the cache can slow
 * this path down, never break it.
 */
async function resolveCached<T>(
  cache: BoundedTtlCache,
  flightKey: string,
  cacheKey: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  shouldCache: (value: T) => boolean,
): Promise<T> {
  if (getPlaybackCacheTtlSeconds() <= 0) return load();

  try {
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit as T;
  } catch (err) {
    logger.error({ msg: '[video] playback cache read failed, falling back to source', err });
    return load();
  }

  const pending = inFlight.get(flightKey);
  if (pending) return pending as Promise<T>;

  const flight = load()
    .then((value) => {
      try {
        if (shouldCache(value)) cache.set(cacheKey, value, ttlSeconds);
      } catch (err) {
        logger.error({ msg: '[video] playback cache write failed', err });
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(flightKey);
    });

  inFlight.set(flightKey, flight);
  return flight;
}

/**
 * The lesson row the video proxy needs, cached for {@link getPlaybackCacheTtlSeconds}.
 * A missing lesson is never cached, so a lesson created moments ago is visible
 * immediately.
 *
 * Invalidate via {@link invalidateLessonPlaybackMeta} anywhere `videoStorageUri`
 * is repointed.
 */
export function resolveLessonPlaybackMeta<T extends object>(
  lessonId: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const key = `meta:lesson:${lessonId}`;
  return resolveCached(
    metaCache,
    key,
    key,
    getPlaybackCacheTtlSeconds(),
    load,
    (value) => value !== null,
  );
}

/**
 * The course row the preview-video proxy needs. Same contract as
 * {@link resolveLessonPlaybackMeta}; invalidate on a `previewVideoStorageUri`
 * repoint.
 */
export function resolveCoursePreviewMeta<T extends object>(
  courseId: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const key = `meta:course:${courseId}`;
  return resolveCached(
    metaCache,
    key,
    key,
    getPlaybackCacheTtlSeconds(),
    load,
    (value) => value !== null,
  );
}

/**
 * The lesson row the POSTER route needs.
 *
 * Deliberately a separate cache key from {@link resolveLessonPlaybackMeta}
 * rather than a wider shared select: both helpers store whatever shape their
 * `load()` returns under their own key, so sharing one key between two
 * different selects would let a poster request populate an entry the video
 * proxy then reads as its own — silently handing it a row with no
 * `videoStorageUri`. Two keys, two shapes, no coupling; the duplicate row is
 * ~300 B and is read once per card rather than once per Range.
 */
export function resolveLessonPosterMeta<T extends object>(
  lessonId: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const key = `meta:lesson-poster:${lessonId}`;
  return resolveCached(
    metaCache,
    key,
    key,
    getPlaybackCacheTtlSeconds(),
    load,
    (value) => value !== null,
  );
}

/**
 * The course row the PREVIEW-POSTER route needs. Same separate-key contract as
 * {@link resolveLessonPosterMeta}.
 */
export function resolveCoursePosterMeta<T extends object>(
  courseId: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  const key = `meta:course-poster:${courseId}`;
  return resolveCached(
    metaCache,
    key,
    key,
    getPlaybackCacheTtlSeconds(),
    load,
    (value) => value !== null,
  );
}

/**
 * Whether this org user may play this course's media.
 *
 * Only a `true` verdict is cached — see the never-cache-the-deny note in the
 * module comment. The cost is that an unenrollment can lag by up to
 * {@link AUTHZ_TTL_SECONDS}; {@link invalidatePlaybackAuthz} closes that window
 * eagerly, leaving the TTL as the backstop.
 */
export function resolvePlaybackAuthz(
  userId: string,
  courseId: string,
  load: () => Promise<boolean>,
): Promise<boolean> {
  const key = `authz:${userId}:${courseId}`;
  return resolveCached(authzCache, key, key, AUTHZ_TTL_SECONDS, load, (allowed) => allowed);
}

/**
 * A storage signed URL for `storageUri`, minted at most once per cache window.
 * `mint` receives the expiry to sign for, so callers never hard-code one.
 *
 * Keyed by a hash of the URI rather than the URI itself purely to bound the key
 * length; storage URIs are opaque and arbitrarily long.
 */
export function resolveSignedPlaybackUrl(
  storageUri: string,
  mint: (expirySeconds: number) => Promise<string>,
): Promise<string> {
  const key = `url:${crypto.createHash('sha256').update(storageUri).digest('hex')}`;
  return resolveCached(
    urlCache,
    key,
    key,
    getSignedUrlCacheTtlSeconds(),
    () => mint(getSignedUrlTtlSeconds()),
    () => true,
  );
}

/**
 * Drop a lesson's cached meta after its `videoStorageUri` has been repointed.
 * The poster entry goes too: a repoint rewrites the poster in the same update,
 * so a surviving entry would keep serving the previous video's still.
 */
export function invalidateLessonPlaybackMeta(lessonId: string): void {
  metaCache.delete(`meta:lesson:${lessonId}`);
  metaCache.delete(`meta:lesson-poster:${lessonId}`);
}

/** Drop a course's cached preview meta after `previewVideoStorageUri` changed. */
export function invalidateCoursePreviewMeta(courseId: string): void {
  metaCache.delete(`meta:course:${courseId}`);
  metaCache.delete(`meta:course-poster:${courseId}`);
}

/**
 * Drop a cached allow so a revoked enrollment stops playing on the next Range
 * request instead of lagging up to the authz TTL. Keyed on the course, so this
 * single call covers every lesson in it.
 */
export function invalidatePlaybackAuthz(userId: string, courseId: string): void {
  authzCache.delete(`authz:${userId}:${courseId}`);
}

/**
 * Apply the browser-caching policy for a proxied video response.
 *
 * `private` is sufficient to keep these bytes out of shared caches: it permits
 * storage only in a cache dedicated to a single user. Verified for this
 * deployment — nginx has no `proxy_cache` configured, and Cloudflare sits in
 * front as a *tunnel* rather than a caching edge (and does not cache 206
 * responses by default in any case). `Vary: Cookie` closes the residual where
 * user A logs out and user B logs in on the same browser profile.
 *
 * Trade: after an unenrollment, bytes already in the learner's own browser
 * cache remain playable locally for up to `max-age`. That is bounded, local to
 * one already-authorised device, and the price of not re-downloading the whole
 * file on every rewind.
 *
 * `VIDEO_CACHE_MAX_AGE_SECONDS` overrides the per-route default for both
 * routes; `0` restores the previous `private, no-store` (and emits no `Vary`,
 * so the disabled path is byte-identical to the pre-change behavior).
 */
export function applyVideoCacheHeaders(headers: Headers, defaultMaxAgeSeconds: number): void {
  const maxAge = readNonNegativeInt(process.env.VIDEO_CACHE_MAX_AGE_SECONDS, defaultMaxAgeSeconds);
  if (maxAge <= 0) {
    headers.set('cache-control', 'private, no-store');
    return;
  }
  headers.set('cache-control', `private, max-age=${maxAge}`);
  headers.set('vary', 'Cookie');
}

/** Default `max-age` for poster images. */
export const POSTER_MAX_AGE_SECONDS = 86400;

/**
 * Apply the browser-caching policy for a proxied poster image.
 *
 * `immutable` is genuinely correct here, unlike almost everywhere it gets used:
 * poster objects are content-addressed (`system/videos/posters/<ts>-<uuid>.jpg`)
 * and are never mutated in place — re-encoding a video writes a NEW key and
 * repoints the row at it. So the bytes behind a given object can never change,
 * and telling the browser not to even revalidate for a day is honest. The one
 * seam is that the ROUTE path is stable while the object behind it is not, so a
 * viewer holding a cached poster keeps seeing the previous still for up to
 * `max-age` after a re-transcode — cosmetic, bounded, and the alternative is a
 * revalidation round trip per card on every catalog view.
 *
 * `private` + `Vary: Cookie` for the same reason as the video routes: these
 * bytes are behind per-user authorization and must never land in a shared cache
 * or survive a user switch on one browser profile.
 *
 * `VIDEO_POSTER_MAX_AGE_SECONDS` overrides the default; `0` emits `no-store`.
 */
export function applyPosterCacheHeaders(headers: Headers): void {
  const maxAge = readNonNegativeInt(
    process.env.VIDEO_POSTER_MAX_AGE_SECONDS,
    POSTER_MAX_AGE_SECONDS,
  );
  if (maxAge <= 0) {
    headers.set('cache-control', 'private, no-store');
    return;
  }
  headers.set('cache-control', `private, max-age=${maxAge}, immutable`);
  headers.set('vary', 'Cookie');
}

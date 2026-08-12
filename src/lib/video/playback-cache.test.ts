/**
 * Adversarial unit tests for the video-proxy playback caches
 * (src/lib/video/playback-cache.ts).
 *
 * This module sits on the Range-request hot path and short-circuits an
 * authorization decision, so a bug here is either a security regression (a
 * cached DENY locking out a freshly-enrolled learner, or worse, an allow
 * leaking across users/courses) or an availability one (a cache fault taking
 * playback down instead of degrading to the DB). Both are tested explicitly,
 * along with the single-flight, TTL-0 kill-switch, expiry and memory-bound
 * contracts documented in the module's JSDoc.
 *
 * The caches are in-process module state, so every test loads a FRESH copy of
 * the module rather than sharing (and leaking) entries between cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type PlaybackCacheModule = typeof import('./playback-cache');

const ENV_KEYS = [
  'VIDEO_PLAYBACK_CACHE_TTL_SECONDS',
  'VIDEO_SIGNED_URL_TTL_SECONDS',
  'VIDEO_CACHE_MAX_AGE_SECONDS',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

/** A fresh module instance, so no test inherits another's cache entries. */
async function loadPlaybackCache(): Promise<PlaybackCacheModule> {
  vi.resetModules();
  return import('./playback-cache');
}

const META = { videoStorageUri: 'minio://bucket/a.mp4', videoProvider: 'self' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('playback authz — cache the ALLOW, never the DENY', () => {
  it('serves a cached allow without re-querying', async () => {
    const { resolvePlaybackAuthz } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(true);

    expect(await resolvePlaybackAuthz('ou-1', 'course-1', load)).toBe(true);
    expect(await resolvePlaybackAuthz('ou-1', 'course-1', load)).toBe(true);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('NEVER caches a deny — a learner who just enrolled is not stuck on a stale 403', async () => {
    const { resolvePlaybackAuthz } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    expect(await resolvePlaybackAuthz('ou-1', 'course-1', load)).toBe(false);
    // The enrollment lands between the two calls; the second must see it.
    expect(await resolvePlaybackAuthz('ou-1', 'course-1', load)).toBe(true);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys on the course, so every lesson of that course shares one cached allow', async () => {
    const { resolvePlaybackAuthz } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(true);

    // Three different lessons of course-1 all resolve the same authz key, so
    // the lesson identity never enters the key and only one query is issued.
    for (let lesson = 0; lesson < 3; lesson++) {
      expect(await resolvePlaybackAuthz('ou-1', 'course-1', load)).toBe(true);
    }

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('scopes the allow to one user and one course', async () => {
    const { resolvePlaybackAuthz } = await loadPlaybackCache();
    const allow = vi.fn().mockResolvedValue(true);
    const deny = vi.fn().mockResolvedValue(false);

    await resolvePlaybackAuthz('ou-1', 'course-1', allow);

    expect(await resolvePlaybackAuthz('ou-2', 'course-1', deny)).toBe(false);
    expect(await resolvePlaybackAuthz('ou-1', 'course-2', deny)).toBe(false);
    expect(deny).toHaveBeenCalledTimes(2);
  });

  it('invalidation clears the allow for every lesson of that course at once', async () => {
    const { resolvePlaybackAuthz, invalidatePlaybackAuthz } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(true);

    await resolvePlaybackAuthz('ou-1', 'course-1', load);
    invalidatePlaybackAuthz('ou-1', 'course-1');

    const afterUnenroll = vi.fn().mockResolvedValue(false);
    expect(await resolvePlaybackAuthz('ou-1', 'course-1', afterUnenroll)).toBe(false);
    expect(await resolvePlaybackAuthz('ou-1', 'course-1', afterUnenroll)).toBe(false);
    expect(afterUnenroll).toHaveBeenCalledTimes(2);
  });
});

describe('playback meta cache', () => {
  it('caches a found lesson and drops it on invalidation', async () => {
    const { resolveLessonPlaybackMeta, invalidateLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(META);

    await resolveLessonPlaybackMeta('lesson-1', load);
    await resolveLessonPlaybackMeta('lesson-1', load);
    expect(load).toHaveBeenCalledTimes(1);

    invalidateLessonPlaybackMeta('lesson-1');
    await resolveLessonPlaybackMeta('lesson-1', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never caches a missing lesson, so a just-created one is visible immediately', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(META);

    expect(await resolveLessonPlaybackMeta('lesson-1', load)).toBeNull();
    expect(await resolveLessonPlaybackMeta('lesson-1', load)).toEqual(META);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the lesson and course namespaces separate for the same id', async () => {
    const { resolveLessonPlaybackMeta, resolveCoursePreviewMeta, invalidateCoursePreviewMeta } =
      await loadPlaybackCache();
    const lessonLoad = vi.fn().mockResolvedValue(META);
    const courseLoad = vi.fn().mockResolvedValue({ previewVideoStorageUri: 'minio://b/p.mp4' });

    await resolveLessonPlaybackMeta('same-id', lessonLoad);
    await resolveCoursePreviewMeta('same-id', courseLoad);
    expect(lessonLoad).toHaveBeenCalledTimes(1);
    expect(courseLoad).toHaveBeenCalledTimes(1);

    // Evicting the course entry must not evict the lesson entry.
    invalidateCoursePreviewMeta('same-id');
    await resolveLessonPlaybackMeta('same-id', lessonLoad);
    await resolveCoursePreviewMeta('same-id', courseLoad);
    expect(lessonLoad).toHaveBeenCalledTimes(1);
    expect(courseLoad).toHaveBeenCalledTimes(2);
  });
});

describe('single-flight', () => {
  it('collapses a burst of concurrent Range requests on a cold key to ONE query', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    let resolveLoad: (value: typeof META) => void = () => {};
    const load = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const flights = Array.from({ length: 12 }, () => resolveLessonPlaybackMeta('lesson-1', load));
    resolveLoad(META);
    const results = await Promise.all(flights);

    expect(load).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result).toEqual(META);
  });

  it('collapses a burst to ONE RSA signature', async () => {
    const { resolveSignedPlaybackUrl } = await loadPlaybackCache();
    const mint = vi.fn().mockResolvedValue('https://storage.example/signed');

    await Promise.all(
      Array.from({ length: 12 }, () => resolveSignedPlaybackUrl('minio://bucket/a.mp4', mint)),
    );

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('does not poison the flight map when the underlying query rejects', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(META);

    await expect(resolveLessonPlaybackMeta('lesson-1', load)).rejects.toThrow('db down');
    await expect(resolveLessonPlaybackMeta('lesson-1', load)).resolves.toEqual(META);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('kill switch — VIDEO_PLAYBACK_CACHE_TTL_SECONDS=0', () => {
  it('disables all three caches, restoring the uncached behavior', async () => {
    process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = '0';
    const {
      getPlaybackCacheTtlSeconds,
      resolveLessonPlaybackMeta,
      resolveCoursePreviewMeta,
      resolvePlaybackAuthz,
      resolveSignedPlaybackUrl,
    } = await loadPlaybackCache();

    expect(getPlaybackCacheTtlSeconds()).toBe(0);

    const metaLoad = vi.fn().mockResolvedValue(META);
    const courseLoad = vi.fn().mockResolvedValue({ previewVideoStorageUri: 'x' });
    const authzLoad = vi.fn().mockResolvedValue(true);
    const mint = vi.fn().mockResolvedValue('https://storage.example/signed');

    for (let i = 0; i < 3; i++) {
      await resolveLessonPlaybackMeta('lesson-1', metaLoad);
      await resolveCoursePreviewMeta('course-1', courseLoad);
      await resolvePlaybackAuthz('ou-1', 'course-1', authzLoad);
      await resolveSignedPlaybackUrl('minio://bucket/a.mp4', mint);
    }

    expect(metaLoad).toHaveBeenCalledTimes(3);
    expect(courseLoad).toHaveBeenCalledTimes(3);
    expect(authzLoad).toHaveBeenCalledTimes(3);
    expect(mint).toHaveBeenCalledTimes(3);
  });

  it('falls back to the default TTL for a malformed or negative value', async () => {
    for (const raw of ['', 'abc', '-5']) {
      process.env.VIDEO_PLAYBACK_CACHE_TTL_SECONDS = raw;
      const { getPlaybackCacheTtlSeconds } = await loadPlaybackCache();
      expect(getPlaybackCacheTtlSeconds()).toBe(60);
    }
  });
});

describe('fail-safe', () => {
  it('treats an internal cache fault as a miss and falls through to the real query', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(META);

    await resolveLessonPlaybackMeta('lesson-1', load);
    expect(load).toHaveBeenCalledTimes(1);

    // The only thing that can throw inside the map read is the expiry check's
    // clock; break it for exactly one call to simulate an internal fault.
    const nowSpy = vi.spyOn(Date, 'now').mockImplementationOnce(() => {
      throw new Error('clock unavailable');
    });

    await expect(resolveLessonPlaybackMeta('lesson-1', load)).resolves.toEqual(META);

    expect(load).toHaveBeenCalledTimes(2);
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[video] playback cache read failed, falling back to source',
      }),
    );
    nowSpy.mockRestore();
  });
});

describe('expiry and memory bounds', () => {
  it('expires an entry once its TTL has passed', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(META);

    vi.useFakeTimers();
    await resolveLessonPlaybackMeta('lesson-1', load);
    await resolveLessonPlaybackMeta('lesson-1', load);
    expect(load).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    await resolveLessonPlaybackMeta('lesson-1', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entries once the entry cap is reached', async () => {
    const { resolveLessonPlaybackMeta } = await loadPlaybackCache();
    const load = vi.fn().mockResolvedValue(META);

    // Comfortably past META_MAX_ENTRIES (1000) so the cap must have bitten,
    // without asserting the exact constant.
    const overCap = 1200;
    for (let i = 0; i < overCap; i++) {
      await resolveLessonPlaybackMeta(`lesson-${i}`, load);
    }
    expect(load).toHaveBeenCalledTimes(overCap);

    // The newest entry survives; the oldest was evicted and must be re-loaded.
    await resolveLessonPlaybackMeta(`lesson-${overCap - 1}`, load);
    expect(load).toHaveBeenCalledTimes(overCap);

    await resolveLessonPlaybackMeta('lesson-0', load);
    expect(load).toHaveBeenCalledTimes(overCap + 1);
  });
});

describe('signed-URL minting and cache TTL', () => {
  it('mints for 3600s by default and reuses the URL for two thirds of that', async () => {
    const { getSignedUrlTtlSeconds, resolveSignedPlaybackUrl } = await loadPlaybackCache();
    expect(getSignedUrlTtlSeconds()).toBe(3600);

    const mint = vi.fn().mockResolvedValue('https://storage.example/signed');
    await resolveSignedPlaybackUrl('minio://bucket/a.mp4', mint);
    expect(mint).toHaveBeenCalledWith(3600);

    vi.useFakeTimers();
    // Still inside the 2400s reuse window.
    vi.advanceTimersByTime(2_399_000);
    await resolveSignedPlaybackUrl('minio://bucket/a.mp4', mint);
    expect(mint).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await resolveSignedPlaybackUrl('minio://bucket/a.mp4', mint);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('clamps the configured mint TTL into the range storage signers accept', async () => {
    process.env.VIDEO_SIGNED_URL_TTL_SECONDS = '1';
    expect((await loadPlaybackCache()).getSignedUrlTtlSeconds()).toBe(60);

    process.env.VIDEO_SIGNED_URL_TTL_SECONDS = '99999999';
    expect((await loadPlaybackCache()).getSignedUrlTtlSeconds()).toBe(604800);

    process.env.VIDEO_SIGNED_URL_TTL_SECONDS = 'nonsense';
    expect((await loadPlaybackCache()).getSignedUrlTtlSeconds()).toBe(3600);
  });

  it('is keyed by storage URI, so a repoint lands on a fresh key rather than a stale URL', async () => {
    const { resolveSignedPlaybackUrl } = await loadPlaybackCache();
    const mint = vi
      .fn()
      .mockResolvedValueOnce('https://storage.example/old')
      .mockResolvedValueOnce('https://storage.example/new');

    expect(await resolveSignedPlaybackUrl('minio://bucket/old.mp4', mint)).toBe(
      'https://storage.example/old',
    );
    expect(await resolveSignedPlaybackUrl('minio://bucket/new.mp4', mint)).toBe(
      'https://storage.example/new',
    );
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe('applyVideoCacheHeaders', () => {
  it('emits private max-age plus Vary: Cookie using the route default', async () => {
    const { applyVideoCacheHeaders, LESSON_VIDEO_MAX_AGE_SECONDS, PREVIEW_VIDEO_MAX_AGE_SECONDS } =
      await loadPlaybackCache();

    const lesson = new Headers();
    applyVideoCacheHeaders(lesson, LESSON_VIDEO_MAX_AGE_SECONDS);
    expect(lesson.get('cache-control')).toBe('private, max-age=900');
    expect(lesson.get('vary')).toBe('Cookie');

    const preview = new Headers();
    applyVideoCacheHeaders(preview, PREVIEW_VIDEO_MAX_AGE_SECONDS);
    expect(preview.get('cache-control')).toBe('private, max-age=3600');
  });

  it('lets VIDEO_CACHE_MAX_AGE_SECONDS override both route defaults', async () => {
    process.env.VIDEO_CACHE_MAX_AGE_SECONDS = '120';
    const { applyVideoCacheHeaders, LESSON_VIDEO_MAX_AGE_SECONDS, PREVIEW_VIDEO_MAX_AGE_SECONDS } =
      await loadPlaybackCache();

    for (const routeDefault of [LESSON_VIDEO_MAX_AGE_SECONDS, PREVIEW_VIDEO_MAX_AGE_SECONDS]) {
      const headers = new Headers();
      applyVideoCacheHeaders(headers, routeDefault);
      expect(headers.get('cache-control')).toBe('private, max-age=120');
    }
  });

  it('restores no-store — and emits no Vary — when set to 0', async () => {
    process.env.VIDEO_CACHE_MAX_AGE_SECONDS = '0';
    const { applyVideoCacheHeaders, LESSON_VIDEO_MAX_AGE_SECONDS } = await loadPlaybackCache();

    const headers = new Headers();
    applyVideoCacheHeaders(headers, LESSON_VIDEO_MAX_AGE_SECONDS);
    expect(headers.get('cache-control')).toBe('private, no-store');
    expect(headers.get('vary')).toBeNull();
  });
});

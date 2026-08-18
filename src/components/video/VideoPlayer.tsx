'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { getVideoPlaybackUrl, saveVideoProgress } from '@/app/actions/video-progress';
import {
  advanceWatchedMark,
  advanceWatchedMarkOnEnded,
  clampSeekTarget,
  watchedPctFromSeconds,
} from '@/lib/video/gating';
import { logger } from '@/lib/logger';

interface VideoPlayerProps {
  lessonId: string;
  enrollmentId: string;
  initialPositionSeconds?: number;
  onWatchedPct?: (pct: number) => void;
  /**
   * Passed straight to the element. The article view mounts one player per
   * lesson, so every INACTIVE one must be `'none'`: with a poster already
   * painting the still frame, `'metadata'` buys nothing visually and costs an
   * authenticated proxy Range request plus the MP4 header — on a phone, over a
   * ~6-connection cap, competing with the video the learner actually pressed
   * play on.
   */
  preload?: 'none' | 'metadata' | 'auto';
  /**
   * Whether this player owns the enrollment's video progress.
   *
   * Every mounted player writes the SAME enrollment row, so exactly one — the
   * active lesson's — may persist. Otherwise a lesson the learner merely
   * scrolled past overwrites the resume position and seeds the watch-gate from
   * the wrong lesson on the next load. Explicit rather than inferred from
   * `onWatchedPct`, so reporting upward and writing to the DB stay separable.
   */
  trackProgress?: boolean;
}

/** `video.currentTime` paired with the wall clock at which it was observed. */
interface PlaybackAnchor {
  mediaSeconds: number;
  wallMs: number;
}

const DEBOUNCE_MS = 10_000;

const GENERIC_LOAD_ERROR = 'This video is currently unavailable.';

export function VideoPlayer({
  lessonId,
  enrollmentId,
  initialPositionSeconds = 0,
  onWatchedPct,
  preload = 'metadata',
  trackProgress = true,
}: VideoPlayerProps) {
  const [loadError, setLoadError] = useState<string | null>(null);

  // Derived, not fetched. The proxy builds this exact path from the lessonId
  // the client already holds, so asking the server for it costs a round trip
  // (auth + a lesson query) to learn nothing. Access is enforced twice without
  // it: the learn route 403s a non-enrolled caller before this component ever
  // renders, and the proxy itself is the real gatekeeper.
  const src = `/api/video/${lessonId}`;

  // Furthest position (seconds) genuinely reached through playback — the
  // watch-through high-water mark. It only advances on steps that satisfy the
  // wall-clock invariant in `advanceWatchedMark` (real playback), never via a
  // forward seek, which defeats scrub-to-unlock. Seeded from the resumed
  // position so returning learners don't have to re-watch watched content.
  const maxWatchedSecondsRef = useRef(initialPositionSeconds);

  // Where playback was, and when, at the previous observation. `advanceWatchedMark`
  // judges each step against THIS rather than against the mark, which is what
  // keeps a single rejected step from wedging the gate forever.
  //
  // Seeded at mount rather than left empty so the very first `timeupdate` is
  // already judged. The mount-time wall clock can be far in the past (a learner
  // who takes a minute to press play), which would hand that first step a large
  // elapsed-time budget — harmless, because media time cannot have moved without
  // a seek, and every seek re-anchors this (see `anchorPlayback`).
  const lastAnchorRef = useRef<PlaybackAnchor>({
    mediaSeconds: initialPositionSeconds,
    wallMs: 0,
  });

  // Last percentage reported to the parent, to avoid redundant callbacks.
  const lastReportedPctRef = useRef(0);

  // Debounce / unmount guards
  const mountedRef = useRef(true);
  const lastSavedAtRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Newest values seen by any handler. Every save reads this at fire time, so a
  // deferred save writes the position reached when the timer fires — not the
  // one captured up to DEBOUNCE_MS earlier when it was scheduled.
  const latestProgressRef = useRef({ positionSeconds: initialPositionSeconds, watchedPct: 0 });

  // Keep a stable ref to enrollmentId so the save closure always sees the
  // current value even if the prop changes between renders.
  const enrollmentIdRef = useRef(enrollmentId);
  useEffect(() => {
    enrollmentIdRef.current = enrollmentId;
  }, [enrollmentId]);

  // Read at fire time, not at schedule time: a player can lose ownership of the
  // enrollment row (the learner navigates to another lesson) while one of its
  // debounced saves is still armed.
  const trackProgressRef = useRef(trackProgress);
  useEffect(() => {
    trackProgressRef.current = trackProgress;
  }, [trackProgress]);

  // ── Mount / unmount guards ───────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    // Reading the clock during render is impure; mount is the earliest an event
    // could reach a handler anyway.
    lastAnchorRef.current.wallMs = Date.now();

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // ── Persist helper ───────────────────────────────────────────────────────
  function flushProgress() {
    if (!trackProgressRef.current) return;
    lastSavedAtRef.current = Date.now();
    const { positionSeconds, watchedPct } = latestProgressRef.current;
    saveVideoProgress(enrollmentIdRef.current, positionSeconds, watchedPct).catch(
      (err: unknown) => {
        logger.warn({
          msg: 'VideoPlayer: failed to save progress',
          err,
          enrollmentId: enrollmentIdRef.current,
        });
      },
    );
  }

  function persistProgress(immediate = false) {
    if (!mountedRef.current) return;
    // Bail before arming a timer for a save that flushProgress would drop anyway.
    if (!trackProgressRef.current) return;

    const msSinceLast = Date.now() - lastSavedAtRef.current;

    if (immediate || msSinceLast >= DEBOUNCE_MS) {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      flushProgress();
      return;
    }

    // Leave an already-pending timer alone. Clearing and re-arming it on every
    // `timeupdate` was the old bug: the save only ever landed once events
    // stopped, and it churned a timer pair ~4×/s for the whole video.
    if (debounceTimerRef.current !== null) return;

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (!mountedRef.current) return;
      flushProgress();
    }, DEBOUNCE_MS - msSinceLast);
  }

  // ── Watch-gate helpers ───────────────────────────────────────────────────
  /** Reports the current watched percentage upward, deduping unchanged values. */
  function reportWatchedPct(durationSeconds: number) {
    const pct = watchedPctFromSeconds(maxWatchedSecondsRef.current, durationSeconds);
    if (pct !== lastReportedPctRef.current) {
      lastReportedPctRef.current = pct;
      onWatchedPct?.(pct);
    }
    return pct;
  }

  /**
   * Re-anchors the playback reference to `mediaSeconds` as of now.
   *
   * Called on every seek, which is what stops elapsed time banking up into a
   * seek allowance: pause for 60s and then scrub forward 60s, and the following
   * `timeupdate` would show a 60s media jump against 60s of wall clock — an
   * exact match for genuine playback. Re-anchoring at the moment of the seek
   * spends that budget, so the first step after a seek is judged against ~0s.
   *
   * Deliberately NOT wired to `visibilitychange`. A backgrounded tab keeps the
   * media clock running while `timeupdate` is suspended, and the large elapsed
   * time that produces is precisely the evidence that the jump WAS playback;
   * re-anchoring on becoming visible would discard it and re-break the gate.
   * `ratechange` needs no anchor either — the rate is read fresh on every step.
   */
  function anchorPlayback(mediaSeconds: number) {
    lastAnchorRef.current = { mediaSeconds, wallMs: Date.now() };
  }

  // ── Video event handlers ─────────────────────────────────────────────────
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (initialPositionSeconds > 0 && initialPositionSeconds < video.duration) {
      video.currentTime = initialPositionSeconds;
    }
    anchorPlayback(video.currentTime);
  }

  /**
   * Block scrub-to-unlock: snap forward seeks that jump past the watch-through
   * high-water mark back to it. Rewinds (and small nudges within tolerance) are
   * left untouched.
   *
   * Clamped on `seeked`, NOT on `seeking`: iOS and Android native scrubbers fire
   * `seeking` continuously through a drag, so clamping there force-wrote every
   * intermediate position and fought the user's finger. `seeked` fires once, when
   * the seek settles. The trade is that the learner briefly sees frames ahead of
   * the gate before it snaps back — acceptable, because this is completion
   * tracking, not DRM, and the mark itself never moves.
   *
   * The corrective write terminates: it re-fires `seeking`/`seeked`, and on that
   * pass `clampSeekTarget` returns null (the target IS the mark, which is inside
   * tolerance), so no second write is issued.
   */
  function handleSeeked(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    const clamped = clampSeekTarget(video.currentTime, maxWatchedSecondsRef.current);
    if (clamped !== null) {
      video.currentTime = clamped;
    }
    anchorPlayback(video.currentTime);
  }

  function handleSeeking(e: React.SyntheticEvent<HTMLVideoElement>) {
    anchorPlayback(e.currentTarget.currentTime);
  }

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.duration) return;

    const { mediaSeconds, wallMs } = lastAnchorRef.current;
    maxWatchedSecondsRef.current = advanceWatchedMark({
      maxWatchedSeconds: maxWatchedSecondsRef.current,
      previousMediaSeconds: mediaSeconds,
      currentMediaSeconds: video.currentTime,
      wallDeltaSeconds: (Date.now() - wallMs) / 1000,
      playbackRate: video.playbackRate,
    });
    anchorPlayback(video.currentTime);

    // Persist the high-water mark (not the live position) so a reload seeds the
    // gate from what was actually watched, never from a rewound position.
    latestProgressRef.current = {
      positionSeconds: maxWatchedSecondsRef.current,
      watchedPct: reportWatchedPct(video.duration),
    };

    // ⚠️ Throttle the SAVE, never this handler. Dropping `timeupdate` events
    // also drops the anchor updates the wall-clock invariant is measured from,
    // which costs the gate its precision for no benefit — the save is already
    // debounced below.
    persistProgress();
  }

  function handlePause(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.duration) return;
    latestProgressRef.current = {
      positionSeconds: maxWatchedSecondsRef.current,
      watchedPct: reportWatchedPct(video.duration),
    };
    persistProgress(true);
  }

  function handleEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    // An unknown duration yields a 0% report, which `saveVideoProgress` would
    // write straight over real stored progress. Same guard as `handlePause`.
    if (!video.duration) return;

    // Reaching the natural end credits the whole video ONLY when the mark is
    // already contiguous with the end — the gate's own rule, not a second one
    // that could disagree with it. A scrub to the tail is credited nothing.
    maxWatchedSecondsRef.current = advanceWatchedMarkOnEnded(
      maxWatchedSecondsRef.current,
      video.duration,
    );
    latestProgressRef.current = {
      positionSeconds: maxWatchedSecondsRef.current,
      watchedPct: reportWatchedPct(video.duration),
    };
    persistProgress(true);
  }

  // The proxy returns 404 when the underlying storage object is gone; the
  // <video> element then fires `error`. Surface a clear inline state instead of
  // a dead player. The proxy also persists the honest status server-side.
  function handleVideoError() {
    logger.error({ msg: '[video] player failed to load source', lessonId });
    if (!mountedRef.current) return;
    setLoadError(GENERIC_LOAD_ERROR);

    // Only the failure path pays for the access pre-flight, and only to refine
    // "unavailable" into the real reason (Forbidden / Lesson not found). If it
    // rejects with anything we can't read, the generic message already stands.
    getVideoPlaybackUrl(lessonId).catch((err: unknown) => {
      if (mountedRef.current && err instanceof Error && err.message) {
        setLoadError(err.message);
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="w-full rounded-lg bg-background-secondary p-4">
        <Alert variant="error" title="Video unavailable">
          {loadError}
        </Alert>
      </div>
    );
  }

  return (
    // The ratio box is load-bearing, not decoration: a bare <video> has no
    // intrinsic ratio until metadata arrives, so the UA default of 2:1 applies
    // and then reflows to 16:9 — shifting everything below it, once per lesson
    // on an article page. `max-h`/`max-w` together cap the box proportionally
    // (height alone would letterbox), keeping the controls above the fold on a
    // ~390px-tall landscape phone.
    <div className="relative mx-auto aspect-video max-h-[70svh] w-full max-w-[calc(70svh*16/9)] overflow-hidden rounded-lg bg-black shadow-md">
      <video
        src={src}
        // Paints the first frame immediately for ~40 KB. 404s (and so paints
        // nothing) for assets transcoded before posters existed, until
        // scripts/backfill-video-posters.ts has run.
        poster={`/api/video/${lessonId}/poster`}
        controls
        // Android Chrome otherwise offers a Download button on the raw MP4.
        controlsList="nodownload"
        // playsInline is REQUIRED for inline playback on iOS Safari — without it
        // iOS hijacks the video into its native fullscreen player.
        playsInline
        preload={preload}
        className="h-full w-full object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onSeeking={handleSeeking}
        onSeeked={handleSeeked}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleVideoError}
      />
    </div>
  );
}

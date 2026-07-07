'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { getVideoPlaybackUrl, saveVideoProgress } from '@/app/actions/video-progress';
import {
  SEEK_FORWARD_TOLERANCE_SECONDS,
  clampSeekTarget,
  watchedPctFromSeconds,
} from '@/lib/video/gating';
import { logger } from '@/lib/logger';

interface VideoPlayerProps {
  lessonId: string;
  enrollmentId: string;
  initialPositionSeconds?: number;
  onWatchedPct?: (pct: number) => void;
}

const DEBOUNCE_MS = 10_000;

export function VideoPlayer({
  lessonId,
  enrollmentId,
  initialPositionSeconds = 0,
  onWatchedPct,
}: VideoPlayerProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Furthest position (seconds) genuinely reached through playback — the
  // watch-through high-water mark. It only advances via small `timeupdate`
  // increments (real playback), never via a forward seek, which defeats
  // scrub-to-unlock. Seeded from the resumed position so returning learners
  // don't have to re-watch already-watched content.
  const maxWatchedSecondsRef = useRef(initialPositionSeconds);

  // Last percentage reported to the parent, to avoid redundant callbacks.
  const lastReportedPctRef = useRef(0);

  // Debounce / unmount guards
  const mountedRef = useRef(true);
  const lastSavedAtRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to enrollmentId so the save closure always sees the
  // current value even if the prop changes between renders.
  const enrollmentIdRef = useRef(enrollmentId);
  useEffect(() => {
    enrollmentIdRef.current = enrollmentId;
  }, [enrollmentId]);

  // ── Resolve signed URL on mount ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    getVideoPlaybackUrl(lessonId)
      .then((url) => {
        if (mountedRef.current) setSrc(url);
      })
      .catch((err: unknown) => {
        logger.error({ msg: 'VideoPlayer: failed to resolve playback URL', err, lessonId });
        if (mountedRef.current) {
          setLoadError(
            err instanceof Error ? err.message : 'Unable to load video. Please try again.',
          );
        }
      });

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [lessonId]);

  // ── Persist helper ───────────────────────────────────────────────────────
  function persistProgress(currentTime: number, watchedPct: number, immediate = false) {
    if (!mountedRef.current) return;

    const now = Date.now();
    const msSinceLast = now - lastSavedAtRef.current;

    // Clear any pending debounce timer
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (immediate || msSinceLast >= DEBOUNCE_MS) {
      // Save right away
      lastSavedAtRef.current = now;
      saveVideoProgress(enrollmentIdRef.current, currentTime, watchedPct).catch((err: unknown) => {
        logger.warn({
          msg: 'VideoPlayer: failed to save progress',
          err,
          enrollmentId: enrollmentIdRef.current,
        });
      });
    } else {
      // Schedule a deferred save for the remainder of the debounce window
      const delay = DEBOUNCE_MS - msSinceLast;
      debounceTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        debounceTimerRef.current = null;
        lastSavedAtRef.current = Date.now();
        saveVideoProgress(enrollmentIdRef.current, currentTime, watchedPct).catch(
          (err: unknown) => {
            logger.warn({ msg: 'VideoPlayer: failed to save deferred progress', err });
          },
        );
      }, delay);
    }
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

  // ── Video event handlers ─────────────────────────────────────────────────
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (initialPositionSeconds > 0 && initialPositionSeconds < video.duration) {
      video.currentTime = initialPositionSeconds;
    }
  }

  // Block scrub-to-unlock: snap forward seeks that jump past the watch-through
  // high-water mark back to it. Rewinds (and small nudges within tolerance) are
  // left untouched.
  function handleSeeking(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    const clamped = clampSeekTarget(video.currentTime, maxWatchedSecondsRef.current);
    if (clamped !== null) {
      video.currentTime = clamped;
    }
  }

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.duration) return;

    // Advance the high-water mark ONLY on small forward steps — i.e. genuine
    // playback. A larger jump means a seek slipped through (the seek handler
    // clamps it), so it must never move the watched mark forward.
    const delta = video.currentTime - maxWatchedSecondsRef.current;
    if (delta > 0 && delta <= SEEK_FORWARD_TOLERANCE_SECONDS) {
      maxWatchedSecondsRef.current = video.currentTime;
    }

    const pct = reportWatchedPct(video.duration);
    // Persist the high-water mark (not the live position) so a reload seeds the
    // gate from what was actually watched, never from a rewound position.
    persistProgress(maxWatchedSecondsRef.current, pct);
  }

  function handlePause(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.duration) return;
    persistProgress(maxWatchedSecondsRef.current, reportWatchedPct(video.duration), true);
  }

  function handleEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    // Reaching the natural end means the whole video was watched.
    maxWatchedSecondsRef.current = video.duration || maxWatchedSecondsRef.current;
    persistProgress(maxWatchedSecondsRef.current, reportWatchedPct(video.duration), true);
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

  if (!src) {
    return (
      <div className="flex w-full items-center justify-center rounded-lg bg-background-secondary py-16">
        <Loader2 className="size-8 animate-spin text-text-secondary" aria-label="Loading video…" />
      </div>
    );
  }

  return (
    <video
      src={src}
      controls
      // playsInline is REQUIRED for inline playback on iOS Safari — without it
      // iOS hijacks the video into its native fullscreen player. preload only
      // metadata so mobile data isn't spent until the user presses play.
      playsInline
      preload="metadata"
      className="w-full rounded-lg bg-black shadow-md"
      onLoadedMetadata={handleLoadedMetadata}
      onSeeking={handleSeeking}
      onTimeUpdate={handleTimeUpdate}
      onPause={handlePause}
      onEnded={handleEnded}
    />
  );
}

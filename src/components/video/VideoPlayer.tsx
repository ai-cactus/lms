'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { getVideoPlaybackUrl, saveVideoProgress } from '@/app/actions/video-progress';
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

  // Furthest watched percentage (monotonically increasing)
  const maxWatchedPctRef = useRef(0);

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

  // ── Video event handlers ─────────────────────────────────────────────────
  function handleLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (initialPositionSeconds > 0 && initialPositionSeconds < video.duration) {
      video.currentTime = initialPositionSeconds;
    }
  }

  function handleTimeUpdate(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.duration) return;

    const currentPct = (video.currentTime / video.duration) * 100;
    const newMax = Math.max(maxWatchedPctRef.current, currentPct);

    if (newMax !== maxWatchedPctRef.current) {
      maxWatchedPctRef.current = newMax;
      onWatchedPct?.(newMax);
    }

    persistProgress(video.currentTime, maxWatchedPctRef.current);
  }

  function handlePause(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    persistProgress(video.currentTime, maxWatchedPctRef.current, true);
  }

  function handleEnded(e: React.SyntheticEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    // Clamp to 100 on ended
    maxWatchedPctRef.current = 100;
    onWatchedPct?.(100);
    persistProgress(video.currentTime, 100, true);
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
      onTimeUpdate={handleTimeUpdate}
      onPause={handlePause}
      onEnded={handleEnded}
    />
  );
}

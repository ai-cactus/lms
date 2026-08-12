/**
 * VideoPlayer — playback-performance regression tests (PR 3).
 *
 * Three behaviours are locked down here:
 *  1. The mount-time `getVideoPlaybackUrl` round trip is gone — the src is
 *     derived — but the error path still resolves a precise message.
 *  2. The progress save is throttled to once per DEBOUNCE_MS and always writes
 *     the LATEST position, never the one captured when the timer was armed.
 *  3. The watch-through high-water mark still advances on ~250ms `timeupdate`
 *     ticks. This is the quiz-unlock path: if anyone throttles the handler
 *     itself past SEEK_FORWARD_TOLERANCE_SECONDS, every playback step reads as
 *     a forward seek, the mark freezes and the quiz never unlocks.
 */
import type { ComponentProps } from 'react';
import { act, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

vi.mock('@/app/actions/video-progress', () => ({
  getVideoPlaybackUrl: vi.fn(),
  saveVideoProgress: vi.fn(),
}));

import { getVideoPlaybackUrl, saveVideoProgress } from '@/app/actions/video-progress';
import { WATCH_GATE_PCT } from '@/lib/video/gating';
import { VideoPlayer } from './VideoPlayer';

const DEBOUNCE_MS = 10_000;
const LESSON_ID = 'lesson-1';
const ENROLLMENT_ID = 'enr-1';

const mockGetUrl = vi.mocked(getVideoPlaybackUrl);
const mockSave = vi.mocked(saveVideoProgress);

beforeAll(() => {
  // jsdom implements neither, and setting `src` on a <video> reaches for them.
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUrl.mockResolvedValue(`/api/video/${LESSON_ID}`);
  mockSave.mockResolvedValue({ unlocked: false });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Renders the player and returns the <video> with driveable media props. */
function renderPlayer(
  durationSeconds: number,
  onWatchedPct?: (pct: number) => void,
  props: Partial<ComponentProps<typeof VideoPlayer>> = {},
) {
  const view = render(
    <VideoPlayer
      lessonId={LESSON_ID}
      enrollmentId={ENROLLMENT_ID}
      onWatchedPct={onWatchedPct}
      {...props}
    />,
  );
  const video = view.container.querySelector('video');
  if (!video) throw new Error('video element not rendered');

  Object.defineProperty(video, 'duration', { configurable: true, value: durationSeconds });
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(video, 'playbackRate', { configurable: true, writable: true, value: 1 });

  return { ...view, video };
}

/** One `timeupdate` at `seconds`, followed by `stepMs` of wall-clock time. */
function tick(video: HTMLVideoElement, seconds: number, stepMs = 250) {
  video.currentTime = seconds;
  fireEvent.timeUpdate(video);
  act(() => {
    vi.advanceTimersByTime(stepMs);
  });
}

/**
 * Advances media AND wall clock together to `seconds`, then fires ONE
 * `timeupdate` — i.e. real-time playback during which no event was delivered.
 * That is what a backgrounded tab looks like from the handler's side.
 */
function playTo(video: HTMLVideoElement, seconds: number) {
  const elapsedMs = Math.max(0, (seconds - video.currentTime) * 1000);
  act(() => {
    vi.advanceTimersByTime(elapsedMs);
  });
  video.currentTime = seconds;
  fireEvent.timeUpdate(video);
  act(() => {
    vi.advanceTimersByTime(250);
  });
}

describe('VideoPlayer — playback URL', () => {
  it('derives the src without calling the server action on mount', async () => {
    const { video } = renderPlayer(100);
    await act(async () => {});

    expect(video).toHaveAttribute('src', `/api/video/${LESSON_ID}`);
    expect(mockGetUrl).not.toHaveBeenCalled();
  });

  it('resolves the precise reason via the action when the element errors', async () => {
    mockGetUrl.mockRejectedValue(new Error('Forbidden'));
    const { video } = renderPlayer(100);

    await act(async () => {
      fireEvent.error(video);
    });

    expect(mockGetUrl).toHaveBeenCalledWith(LESSON_ID);
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
  });

  it('keeps the generic message when the pre-flight rejects unreadably', async () => {
    mockGetUrl.mockRejectedValue('socket hang up');
    const { video } = renderPlayer(100);

    await act(async () => {
      fireEvent.error(video);
    });

    expect(screen.getByText('This video is currently unavailable.')).toBeInTheDocument();
  });
});

describe('VideoPlayer — watch gate (quiz-unlock regression lock)', () => {
  it('advances the high-water mark across 250ms ticks until the gate is reached', () => {
    const onWatchedPct = vi.fn();
    const durationSeconds = 40;
    const { video } = renderPlayer(durationSeconds, onWatchedPct);

    // Real-time playback: 0.25s of media per 250ms tick — well inside
    // SEEK_FORWARD_TOLERANCE_SECONDS, so every step is genuine playback.
    for (let seconds = 0.25; seconds <= durationSeconds; seconds += 0.25) {
      tick(video, seconds);
    }

    const reported = onWatchedPct.mock.calls.map(([pct]) => pct as number);
    expect(Math.max(...reported)).toBeGreaterThanOrEqual(WATCH_GATE_PCT);
    expect(reported.at(-1)).toBe(100);
  });

  it('does not advance the mark on a forward jump beyond the seek tolerance', () => {
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(100, onWatchedPct);

    tick(video, 1);
    tick(video, 90);

    expect(onWatchedPct).toHaveBeenLastCalledWith(1);
  });

  it('THE REGRESSION LOCK: a backgrounded tab still reaches the gate', () => {
    // Screen lock / incoming call suspends `timeupdate` while the media clock
    // runs on, so `currentTime` comes back having jumped minutes in ONE event.
    // The previous fixed-1.5s rule read that as a seek, froze the mark
    // permanently, and the quiz never unlocked again.
    const onWatchedPct = vi.fn();
    const durationSeconds = 600;
    const { video } = renderPlayer(durationSeconds, onWatchedPct);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);

    // Hidden for 565s — and 565s of media went by with it.
    playTo(video, 595);

    for (let seconds = 595.25; seconds <= durationSeconds; seconds += 0.25) tick(video, seconds);

    const reported = onWatchedPct.mock.calls.map(([pct]) => pct as number);
    expect(Math.max(...reported)).toBeGreaterThanOrEqual(WATCH_GATE_PCT);
    expect(reported.at(-1)).toBe(100);
  });

  it('THE REGRESSION LOCK: the same jump with no elapsed time is refused', () => {
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(600, onWatchedPct);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);
    expect(onWatchedPct).toHaveBeenLastCalledWith(5);

    // A scrub: media jumps 565s while the wall clock barely moves.
    video.currentTime = 595;
    fireEvent.timeUpdate(video);

    expect(onWatchedPct).toHaveBeenLastCalledWith(5);
  });

  it('re-anchors on a seek so paused time cannot be banked into a scrub', () => {
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(600, onWatchedPct);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);

    // A minute of wall clock passes while the video sits paused.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Now scrub 60s forward. Without the re-anchor on `seeking`, that idle
    // minute would exactly "pay" for the 60s media jump and read as playback.
    video.currentTime = 90;
    fireEvent.seeking(video);
    fireEvent.timeUpdate(video);

    expect(onWatchedPct).toHaveBeenLastCalledWith(5);
  });

  it('THE BYPASS LOCK: `ended` after a scrub to the tail credits nothing', () => {
    // The seek clamp only snaps back on `seeked`. If any UA delivers `ended`
    // first, this is the last thing standing between a scrub and an unlocked
    // quiz, course completion and attestation.
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(600, onWatchedPct);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);
    expect(onWatchedPct).toHaveBeenLastCalledWith(5);

    video.currentTime = 600;
    fireEvent.ended(video);

    expect(onWatchedPct).toHaveBeenLastCalledWith(5);
  });

  it('credits 100% when the final `timeupdate` lands a beat before duration', () => {
    // Browsers routinely stop firing `timeupdate` a tick early, so the mark sits
    // just short of `duration` at the moment `ended` arrives.
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(200, onWatchedPct);

    playTo(video, 198.75);
    expect(onWatchedPct).toHaveBeenLastCalledWith(99);

    video.currentTime = 200;
    fireEvent.ended(video);

    expect(onWatchedPct).toHaveBeenLastCalledWith(100);
  });

  it('does not corrupt the mark when `ended` arrives with an unknown duration', () => {
    const onWatchedPct = vi.fn();
    const { video } = renderPlayer(600, onWatchedPct);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);
    expect(onWatchedPct).toHaveBeenLastCalledWith(5);

    for (const duration of [Number.NaN, 0]) {
      Object.defineProperty(video, 'duration', { configurable: true, value: duration });
      fireEvent.ended(video);
    }

    // A 0% report here would be written straight over real stored progress.
    expect(onWatchedPct).toHaveBeenLastCalledWith(5);

    // The mark survived: with the duration known again it still reads 30s.
    Object.defineProperty(video, 'duration', { configurable: true, value: 600 });
    fireEvent.pause(video);
    expect(mockSave).toHaveBeenLastCalledWith(ENROLLMENT_ID, 30, 5);
  });

  it('clamps a forward seek on `seeked`, not mid-drag on `seeking`', () => {
    const { video } = renderPlayer(600);

    for (let seconds = 0.25; seconds <= 30; seconds += 0.25) tick(video, seconds);

    // Native mobile scrubbers fire `seeking` continuously through a drag;
    // rewriting currentTime on each one fought the user's finger.
    video.currentTime = 400;
    fireEvent.seeking(video);
    expect(video.currentTime).toBe(400);

    fireEvent.seeked(video);
    expect(video.currentTime).toBe(30);

    // The corrective write terminates — re-running the handler is a no-op.
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(30);
  });
});

describe('VideoPlayer — responsive shell', () => {
  it('renders the video inside a fixed-ratio, height-capped box', () => {
    const { container } = renderPlayer(100);

    const box = container.querySelector('div');
    expect(box?.className).toContain('aspect-video');
    expect(box?.className).toContain('max-h-[70svh]');
  });

  it('lets the frame letterbox rather than stretch, and hides the download control', () => {
    const { video } = renderPlayer(100);

    expect(video.className).toContain('object-contain');
    expect(video).toHaveAttribute('controlsList', 'nodownload');
    expect(video).toHaveAttribute('playsinline');
  });

  it('defaults to preload=metadata and honors an explicit override', () => {
    expect(renderPlayer(100).video).toHaveAttribute('preload', 'metadata');
    expect(renderPlayer(100, undefined, { preload: 'none' }).video).toHaveAttribute(
      'preload',
      'none',
    );
  });
});

describe('VideoPlayer — progress persistence', () => {
  it('saves once per debounce window and arms the timer once, not per tick', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { video } = renderPlayer(1000);

    const ticks = DEBOUNCE_MS / 250;
    for (let i = 1; i <= ticks; i += 1) {
      tick(video, i * 0.25);
    }

    // The leading save on the first tick, then the trailing one when the window
    // closes — not one per tick.
    expect(mockSave).toHaveBeenCalledTimes(2);

    // Only the debounce uses a delay this long; React's own scheduling doesn't.
    // Re-arming per tick (the old behaviour) would show ~40 of each.
    const debounceArms = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === 'number' && delay > 1_000,
    );
    expect(debounceArms).toHaveLength(1);
    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  });

  it('writes the latest position when the deferred save fires, not the scheduled one', () => {
    const { video } = renderPlayer(1000);

    for (let i = 1; i <= DEBOUNCE_MS / 250; i += 1) {
      tick(video, i * 0.25);
    }

    // The timer was armed on the second tick (position 0.5) and fires a full
    // window later; it must report where playback actually got to by then.
    expect(mockSave).toHaveBeenLastCalledWith(ENROLLMENT_ID, 10, 1);
  });

  it('flushes immediately on pause', () => {
    const { video } = renderPlayer(100);

    tick(video, 1);
    expect(mockSave).toHaveBeenCalledTimes(1);

    video.currentTime = 1.25;
    fireEvent.timeUpdate(video);
    fireEvent.pause(video);

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenLastCalledWith(ENROLLMENT_ID, 1.25, 1);
  });

  it('flushes immediately on ended, crediting the full duration after a play-through', () => {
    const durationSeconds = 40;
    const { video } = renderPlayer(durationSeconds);

    for (let seconds = 0.25; seconds <= durationSeconds; seconds += 0.25) tick(video, seconds);
    fireEvent.ended(video);

    expect(mockSave).toHaveBeenLastCalledWith(ENROLLMENT_ID, durationSeconds, 100);
  });

  it('flushes immediately on ended even when the mark is not credited', () => {
    const { video } = renderPlayer(100);

    tick(video, 1);
    expect(mockSave).toHaveBeenCalledTimes(1);

    video.currentTime = 100;
    fireEvent.ended(video);

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave).toHaveBeenLastCalledWith(ENROLLMENT_ID, 1, 1);
  });

  it('writes nothing when the player does not own the enrollment row', () => {
    // Article view mounts one player per lesson and they all target the SAME
    // enrollment; a non-active one persisting would overwrite the resume
    // position with a lesson the learner only scrolled past.
    const { video } = renderPlayer(1000, undefined, { trackProgress: false });

    for (let i = 1; i <= DEBOUNCE_MS / 250; i += 1) tick(video, i * 0.25);
    fireEvent.pause(video);
    video.currentTime = 1000;
    fireEvent.ended(video);
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(mockSave).not.toHaveBeenCalled();
  });

  it('never fires a pending deferred save after unmount', () => {
    const { video, unmount } = renderPlayer(1000);

    tick(video, 0.25);
    tick(video, 0.5);
    expect(mockSave).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});

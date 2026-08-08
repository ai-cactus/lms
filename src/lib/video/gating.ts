// Watch-through gating for compliance video lessons.
//
// The quiz only unlocks once the learner has genuinely watched the video. To
// defeat scrub-to-unlock we track a high-water mark of the furthest position
// reached through actual playback (see VideoPlayer) and clamp forward seeks
// back to it. Both the client player and the server action import these helpers
// so the threshold stays a single source of truth.

/** Percentage of the video that must be watched (via real playback) to unlock the quiz. */
export const WATCH_GATE_PCT = 95;

/**
 * Forward-seek slack, in seconds. A seek that lands at most this far past the
 * high-water mark is allowed (covers native currentTime jitter and buffering
 * nudges); anything beyond is clamped back. Rewinding is always unrestricted.
 */
export const SEEK_FORWARD_TOLERANCE_SECONDS = 1.5;

export function isQuizUnlocked(watchedPct: number | null | undefined): boolean {
  return typeof watchedPct === 'number' && watchedPct >= WATCH_GATE_PCT;
}

/** One `timeupdate` step, as seen from the previous one. */
export interface WatchedMarkStep {
  /** The watch-through high-water mark before this step. */
  maxWatchedSeconds: number;
  /** `video.currentTime` at the PREVIOUS `timeupdate` (or the last seek). */
  previousMediaSeconds: number;
  /** `video.currentTime` now. */
  currentMediaSeconds: number;
  /** Wall-clock seconds elapsed since that previous observation. */
  wallDeltaSeconds: number;
  /** `video.playbackRate` now. Never assume 1 — learners do use 1.5x/2x. */
  playbackRate: number;
  toleranceSeconds?: number;
}

/**
 * Returns the high-water mark after one `timeupdate`.
 *
 * ⚠️ THE INVARIANT — do not "simplify" this back to a fixed media-time
 * threshold. During genuine playback the media clock CANNOT outrun the wall
 * clock scaled by `playbackRate`; during a seek it can, because media time jumps
 * while no wall time passes. So a step is genuine playback exactly when
 *
 *     mediaDelta <= wallDelta * playbackRate + tolerance
 *
 * The previous rule — `mediaDelta <= 1.5s`, measured against the MARK — had an
 * absorbing failure state: any single gap over 1.5s left the mark permanently
 * more than 1.5s behind, so every later step also read as a seek and the mark
 * never advanced again. Mobile hits that routinely (backgrounding the tab
 * suspends `timeupdate` while the media clock runs on, so `currentTime` jumps
 * seconds-to-minutes in one event; so does ≥1.5s of main-thread jank). The
 * symptoms were a quiz that never unlocked and a video that snapped backwards.
 * The wall-clock form is immune by construction: 60s backgrounded with 60s of
 * media progress has `mediaDelta ≈ wallDelta` → genuine; a 60s forward seek has
 * `wallDelta ≈ 0.25s` → not genuine.
 *
 * Two rules, both required:
 *  1. Genuineness (above) — a seek never advances the mark.
 *  2. Contiguity — playback that STARTS more than `toleranceSeconds` past the
 *     mark cannot extend it. Without this, a learner who scrubbed ahead could
 *     wait one 250ms tick and have that (genuine, in-place) playback step carry
 *     the mark to the scrubbed position.
 *
 * Because each step is judged against the PREVIOUS step rather than against the
 * mark, a rejected step can never wedge the gate: the next normal tick is a
 * small delta again and the mark resumes advancing.
 */
export function advanceWatchedMark({
  maxWatchedSeconds,
  previousMediaSeconds,
  currentMediaSeconds,
  wallDeltaSeconds,
  playbackRate,
  toleranceSeconds = SEEK_FORWARD_TOLERANCE_SECONDS,
}: WatchedMarkStep): number {
  const mediaDelta = currentMediaSeconds - previousMediaSeconds;
  // Also rejects NaN (an unseeded currentTime), which would otherwise poison the mark.
  if (!(mediaDelta > 0)) return maxWatchedSeconds;

  // A UA reporting a nonsensical rate falls back to the HTML default of 1x.
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  // A negative or non-finite elapsed time yields no budget at all, never a bonus.
  const wallDelta =
    Number.isFinite(wallDeltaSeconds) && wallDeltaSeconds > 0 ? wallDeltaSeconds : 0;

  if (mediaDelta > wallDelta * rate + toleranceSeconds) return maxWatchedSeconds;
  if (previousMediaSeconds > maxWatchedSeconds + toleranceSeconds) return maxWatchedSeconds;

  return Math.max(maxWatchedSeconds, currentMediaSeconds);
}

/**
 * Returns the high-water mark after the element reaches its natural end.
 *
 * `ended` is not by itself proof of a watch-through — it fires wherever playback
 * happens to be sitting. The seek clamp only snaps a forward scrub back on
 * `seeked`, so any user agent that delivered `ended` first would hand a
 * scrub-to-the-tail learner a full credit on a gate that drives quiz unlock,
 * course completion and attestation. Rather than trust event ordering, apply the
 * same contiguity rule the step function uses: credit the full duration only
 * when the mark is ALREADY within `toleranceSeconds` of the end — i.e. the
 * learner genuinely played through and the final `timeupdate` merely landed a
 * beat early, which browsers routinely do. A learner who scrubbed there has a
 * mark far behind and is credited nothing.
 *
 * The tolerance is shared with `advanceWatchedMark` on purpose: two definitions
 * of "contiguous" could disagree, and this one guards a compliance control.
 *
 * A clip shorter than the tolerance is always credited — there is no meaningful
 * amount of it left to skip.
 */
export function advanceWatchedMarkOnEnded(
  maxWatchedSeconds: number,
  durationSeconds: number,
  toleranceSeconds: number = SEEK_FORWARD_TOLERANCE_SECONDS,
): number {
  // Rejects NaN (metadata not yet known), 0 and Infinity (live/streaming), any
  // of which would otherwise write a nonsense mark.
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return maxWatchedSeconds;
  // Negated so a NaN mark also leaves here unchanged rather than poisoning itself.
  if (!(maxWatchedSeconds >= durationSeconds - toleranceSeconds)) return maxWatchedSeconds;

  return Math.max(maxWatchedSeconds, durationSeconds);
}

/**
 * Converts a furthest-watched time (seconds) into a clamped 0–100 integer
 * percentage of the video's duration. Returns 0 when the duration is unknown.
 */
export function watchedPctFromSeconds(maxWatchedSeconds: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0;
  const pct = (maxWatchedSeconds / durationSeconds) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Given a requested seek target and the furthest continuously-watched position,
 * returns the position the player should snap to — or `null` when the seek is
 * allowed and no correction is needed.
 *
 * - Rewinds (at or before the high-water mark) always pass through (`null`).
 * - Forward seeks within `toleranceSeconds` of the high-water mark pass through.
 * - Forward seeks beyond that are clamped back to the high-water mark, so the
 *   learner cannot scrub ahead of what they have actually watched.
 *
 * Returning `null` (rather than the unchanged target) lets the caller skip a
 * redundant `currentTime` assignment, avoiding a self-triggered seek loop.
 */
export function clampSeekTarget(
  requestedSeconds: number,
  maxWatchedSeconds: number,
  toleranceSeconds: number = SEEK_FORWARD_TOLERANCE_SECONDS,
): number | null {
  if (requestedSeconds > maxWatchedSeconds + toleranceSeconds) {
    return maxWatchedSeconds;
  }
  return null;
}

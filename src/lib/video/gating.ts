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

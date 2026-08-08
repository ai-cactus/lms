import { describe, it, expect } from 'vitest';
import {
  SEEK_FORWARD_TOLERANCE_SECONDS,
  WATCH_GATE_PCT,
  advanceWatchedMark,
  advanceWatchedMarkOnEnded,
  clampSeekTarget,
  isQuizUnlocked,
  watchedPctFromSeconds,
} from './gating';
describe('isQuizUnlocked', () => {
  it(`unlocks at >= ${'WATCH_GATE_PCT'}`, () => {
    expect(WATCH_GATE_PCT).toBe(95);
    expect(isQuizUnlocked(94)).toBe(false);
    expect(isQuizUnlocked(95)).toBe(true);
    expect(isQuizUnlocked(100)).toBe(true);
  });
  it('treats missing progress as locked', () => {
    expect(isQuizUnlocked(null)).toBe(false);
    expect(isQuizUnlocked(undefined)).toBe(false);
  });
});

describe('watchedPctFromSeconds', () => {
  it('returns 0 when the duration is unknown or non-positive', () => {
    expect(watchedPctFromSeconds(50, 0)).toBe(0);
    expect(watchedPctFromSeconds(50, -1)).toBe(0);
    expect(watchedPctFromSeconds(50, Number.NaN)).toBe(0);
  });

  it('computes a rounded 0–100 percentage', () => {
    expect(watchedPctFromSeconds(0, 100)).toBe(0);
    expect(watchedPctFromSeconds(50, 100)).toBe(50);
    expect(watchedPctFromSeconds(95, 100)).toBe(95);
    expect(watchedPctFromSeconds(99.4, 100)).toBe(99);
    expect(watchedPctFromSeconds(99.6, 100)).toBe(100);
  });

  it('clamps overshoot to 100', () => {
    expect(watchedPctFromSeconds(120, 100)).toBe(100);
  });

  it('is gate-aware: below/at/above the watch threshold', () => {
    // 94% watched → locked
    expect(isQuizUnlocked(watchedPctFromSeconds(94, 100))).toBe(false);
    // exactly at the 95% threshold → unlocked
    expect(isQuizUnlocked(watchedPctFromSeconds(95, 100))).toBe(true);
    // full watch-through → unlocked
    expect(isQuizUnlocked(watchedPctFromSeconds(100, 100))).toBe(true);
  });
});

describe('clampSeekTarget', () => {
  it('allows rewinds (returns null)', () => {
    expect(clampSeekTarget(10, 50)).toBeNull();
    expect(clampSeekTarget(0, 50)).toBeNull();
    expect(clampSeekTarget(50, 50)).toBeNull();
  });

  it('allows small forward nudges within tolerance', () => {
    expect(clampSeekTarget(50 + SEEK_FORWARD_TOLERANCE_SECONDS, 50)).toBeNull();
    expect(clampSeekTarget(51, 50)).toBeNull();
  });

  it('clamps forward seeks beyond tolerance back to the high-water mark', () => {
    expect(clampSeekTarget(90, 50)).toBe(50);
    expect(clampSeekTarget(50 + SEEK_FORWARD_TOLERANCE_SECONDS + 0.01, 50)).toBe(50);
  });

  it('clamping to the high-water mark is idempotent (no seek loop)', () => {
    // Re-applying the clamped target must not trigger another clamp.
    const clamped = clampSeekTarget(90, 50);
    expect(clamped).toBe(50);
    expect(clampSeekTarget(clamped as number, 50)).toBeNull();
  });

  it('honors a custom tolerance', () => {
    expect(clampSeekTarget(55, 50, 10)).toBeNull();
    expect(clampSeekTarget(61, 50, 10)).toBe(50);
  });
});

describe('advanceWatchedMark', () => {
  /** One real-time playback step: media and wall clock move together. */
  const playbackStep = (mark: number, from: number, to: number) =>
    advanceWatchedMark({
      maxWatchedSeconds: mark,
      previousMediaSeconds: from,
      currentMediaSeconds: to,
      wallDeltaSeconds: to - from,
      playbackRate: 1,
    });

  it('advances on an ordinary 250ms playback tick', () => {
    expect(playbackStep(10, 10, 10.25)).toBe(10.25);
  });

  it('THE REGRESSION LOCK: credits a 60s jump when 60s of wall clock also passed', () => {
    // A backgrounded tab (screen lock, incoming call) suspends `timeupdate`
    // while the media clock runs on. The old fixed 1.5s media-time rule read
    // this as a seek, froze the mark forever and the quiz never unlocked.
    expect(playbackStep(30, 30, 90)).toBe(90);
  });

  it('THE REGRESSION LOCK: refuses the same 60s jump when no wall clock passed', () => {
    expect(
      advanceWatchedMark({
        maxWatchedSeconds: 30,
        previousMediaSeconds: 30,
        currentMediaSeconds: 90,
        wallDeltaSeconds: 0.25,
        playbackRate: 1,
      }),
    ).toBe(30);
  });

  it('never wedges: a rejected step does not stop the next genuine one', () => {
    // This is what the old rule got wrong — it measured against the MARK, so one
    // over-tolerance gap left every later step over tolerance too.
    const afterSeek = advanceWatchedMark({
      maxWatchedSeconds: 30,
      previousMediaSeconds: 30,
      currentMediaSeconds: 90,
      wallDeltaSeconds: 0.25,
      playbackRate: 1,
    });
    expect(afterSeek).toBe(30);
    // The learner rewinds back inside the watched region and plays on.
    expect(playbackStep(afterSeek, 29, 29.25)).toBe(30);
    expect(playbackStep(afterSeek, 30, 30.25)).toBe(30.25);
  });

  it('scales the budget by playbackRate rather than assuming 1x', () => {
    // 2x playback covers 20s of media in 10s of wall clock — genuine.
    expect(
      advanceWatchedMark({
        maxWatchedSeconds: 5,
        previousMediaSeconds: 5,
        currentMediaSeconds: 25,
        wallDeltaSeconds: 10,
        playbackRate: 2,
      }),
    ).toBe(25);
    // The same jump at 1x is not.
    expect(
      advanceWatchedMark({
        maxWatchedSeconds: 5,
        previousMediaSeconds: 5,
        currentMediaSeconds: 25,
        wallDeltaSeconds: 10,
        playbackRate: 1,
      }),
    ).toBe(5);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
  ])('falls back to 1x for a %s playbackRate', (_label, playbackRate) => {
    expect(
      advanceWatchedMark({
        maxWatchedSeconds: 0,
        previousMediaSeconds: 0,
        currentMediaSeconds: 10,
        wallDeltaSeconds: 10,
        playbackRate,
      }),
    ).toBe(10);
  });

  it('grants no budget for a negative or non-finite elapsed time', () => {
    for (const wallDeltaSeconds of [-30, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = advanceWatchedMark({
        maxWatchedSeconds: 10,
        previousMediaSeconds: 10,
        currentMediaSeconds: 40,
        wallDeltaSeconds,
        playbackRate: 1,
      });
      expect(result).toBe(10);
    }
  });

  it('ignores rewinds and stalls (no forward media progress)', () => {
    expect(playbackStep(50, 50, 20)).toBe(50);
    expect(playbackStep(50, 50, 50)).toBe(50);
    expect(
      advanceWatchedMark({
        maxWatchedSeconds: 50,
        previousMediaSeconds: 50,
        currentMediaSeconds: Number.NaN,
        wallDeltaSeconds: 0.25,
        playbackRate: 1,
      }),
    ).toBe(50);
  });

  it('re-watching behind the mark never moves it backwards', () => {
    expect(playbackStep(50, 10, 10.25)).toBe(50);
  });

  it('CONTIGUITY: playback that starts past the mark cannot extend it', () => {
    // A learner who scrubbed to 300 and let it play must not have that genuine
    // (in-place) playback carry the mark with it.
    expect(playbackStep(10, 300, 300.25)).toBe(10);
    // Still true after any number of ticks out there.
    expect(playbackStep(10, 600, 600.25)).toBe(10);
  });

  it('CONTIGUITY: resuming from just inside the tolerance still counts', () => {
    const from = 10 + SEEK_FORWARD_TOLERANCE_SECONDS;
    expect(playbackStep(10, from, from + 0.25)).toBe(from + 0.25);
    expect(playbackStep(10, from + 0.01, from + 0.26)).toBe(10);
  });

  it('drives the gate to unlock across a backgrounded watch-through', () => {
    // 600s video: 30s of normal ticks, the tab is backgrounded for the middle
    // 9 minutes, then a few more ticks. The gate must reach WATCH_GATE_PCT.
    let mark = 0;
    for (let t = 0.25; t <= 30; t += 0.25) mark = playbackStep(mark, t - 0.25, t);
    mark = playbackStep(mark, 30, 595);
    for (let t = 595.25; t <= 600; t += 0.25) mark = playbackStep(mark, t - 0.25, t);

    expect(isQuizUnlocked(watchedPctFromSeconds(mark, 600))).toBe(true);
  });
});

describe('advanceWatchedMarkOnEnded', () => {
  it('credits the full duration after a genuine play-through', () => {
    expect(advanceWatchedMarkOnEnded(600, 600)).toBe(600);
  });

  it('credits the full duration when the last timeupdate landed a beat early', () => {
    // Browsers commonly stop firing `timeupdate` one ~250ms tick before
    // `duration`; the learner still watched the whole thing.
    expect(advanceWatchedMarkOnEnded(599.75, 600)).toBe(600);
    expect(advanceWatchedMarkOnEnded(600 - SEEK_FORWARD_TOLERANCE_SECONDS, 600)).toBe(600);
  });

  it('THE BYPASS LOCK: refuses to credit a mark that is not contiguous with the end', () => {
    // `ended` fires wherever playback is sitting. If any UA delivers it before
    // the `seeked` clamp snaps a scrub back, this is all that stands between a
    // scrub-to-the-tail and a fully unlocked quiz + attestation.
    expect(advanceWatchedMarkOnEnded(5, 600)).toBe(5);

    const justOutside = 600 - SEEK_FORWARD_TOLERANCE_SECONDS - 0.01;
    expect(advanceWatchedMarkOnEnded(justOutside, 600)).toBe(justOutside);
  });

  it('leaves the gate locked for a scrubbed tail, and unlocked for a play-through', () => {
    const scrubbed = advanceWatchedMarkOnEnded(5, 600);
    expect(isQuizUnlocked(watchedPctFromSeconds(scrubbed, 600))).toBe(false);

    const playedThrough = advanceWatchedMarkOnEnded(599.75, 600);
    expect(isQuizUnlocked(watchedPctFromSeconds(playedThrough, 600))).toBe(true);
  });

  it('credits a clip shorter than the tolerance even with no prior timeupdate', () => {
    // A 1s clip can end before a single tick lands; there is nothing left in it
    // to skip, so withholding credit would just wedge the gate.
    expect(advanceWatchedMarkOnEnded(0, 1)).toBe(1);
  });

  it('leaves the mark untouched when the duration is unknown or unbounded', () => {
    for (const duration of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(advanceWatchedMarkOnEnded(42, duration)).toBe(42);
    }
  });

  it('never moves the mark backwards', () => {
    expect(advanceWatchedMarkOnEnded(605, 600)).toBe(605);
  });

  it('honors a custom tolerance', () => {
    expect(advanceWatchedMarkOnEnded(590, 600, 10)).toBe(600);
    expect(advanceWatchedMarkOnEnded(589, 600, 10)).toBe(589);
  });
});

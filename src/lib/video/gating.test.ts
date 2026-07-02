import { describe, it, expect } from 'vitest';
import {
  SEEK_FORWARD_TOLERANCE_SECONDS,
  WATCH_GATE_PCT,
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

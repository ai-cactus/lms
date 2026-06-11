import { describe, it, expect } from 'vitest';
import { WATCH_GATE_PCT, isQuizUnlocked } from './gating';
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

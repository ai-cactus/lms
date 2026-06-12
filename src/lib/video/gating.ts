export const WATCH_GATE_PCT = 95;
export function isQuizUnlocked(watchedPct: number | null | undefined): boolean {
  return typeof watchedPct === 'number' && watchedPct >= WATCH_GATE_PCT;
}

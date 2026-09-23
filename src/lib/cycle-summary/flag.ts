/**
 * The single cutover switch for the unified cycle summary.
 *
 * ONE flag deliberately governs both halves of the cutover, because they only
 * make sense together:
 *
 *   * the DISPATCH side (`src/lib/reminders/dispatch.ts`) — when on, the ladder
 *     and nudge paths still claim their dedup rows and still write in-app
 *     notifications, but send no email of their own and leave `summarizedAt`
 *     null for the composer;
 *   * the WORKER side (`src/lib/queue/cycle-summary-worker.ts`) — when on, the
 *     daily composer runs in place of the notification digest and sends the one
 *     email per recipient that covers everything.
 *
 * Splitting them across two flags would allow the two states nobody wants:
 * reminders suppressed with no composer to deliver them (silence), or both
 * streams live at once (the duplication this cutover exists to remove).
 *
 * Opt-in (`'true'` exactly), unlike the default-on sweep flags: until an
 * environment has deliberately switched over, the pre-cutover behaviour is the
 * correct behaviour. No I/O and no imports, so it is safe to read from a Server
 * Action, a worker or the Edge-adjacent module graph alike.
 */
export function isCycleSummaryEnabled(): boolean {
  return process.env.CYCLE_SUMMARY_ENABLED === 'true';
}

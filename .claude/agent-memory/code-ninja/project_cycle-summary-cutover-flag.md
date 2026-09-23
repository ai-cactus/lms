---
name: project-cycle-summary-cutover-flag
description: CYCLE_SUMMARY_ENABLED is ONE flag over both dispatch and worker; digest+compose share a claim row, so flip/roll back outside 08:00–13:00 UTC
metadata:
  type: project
---

`CYCLE_SUMMARY_ENABLED` (opt-in, exactly `'true'`) governs BOTH halves of the
unified-email cutover from one module, `src/lib/cycle-summary/flag.ts`: dispatch
stops emailing, and the summary worker starts in place of the notification
digest. `getNotificationDigestWorker` checks the same flag itself, so the two
can never both run.

**Why one flag:** two would allow the only states nobody wants — reminders
suppressed with no composer to deliver them (silence), or both streams live
(the duplication the cutover removes).

**The timing window.** `digest.ts` (flag off) and `compose.ts` (flag on) both
claim `CycleSummaryRun (organizationId, periodKey)`, and for a daily org the key
is the same string. First claim wins, so no double send — but:

- **OFF → ON after that day's digest ran:** compose hits P2002 and skips the org
  for the rest of the day. Rows stay null and are summarized tomorrow. Late, not
  lost.
- **ON → OFF between the 08:00 UTC sweep and the 13:00 UTC summary:** that
  sweep's rows are claimed, un-emailed and now have no composer. The ladder
  won't re-fire them (`ReminderLog` P2002), so those learners miss one email
  (they still got the in-app notification). Bounded at one day.

**The other half of the flip: failed per-stage EMAIL.** The two retry passes
select disjoint `EmailMessage.kind`s — `runCycleSummaryRetry` takes
`cycle_summary` only — so a `reminder_stage` row already `failed` when the flag
flipped has no owner unless the sweep's pre-pass keeps looking. It therefore
NARROWS (to `LEGACY_REMINDER_EMAIL_KINDS`) rather than standing down; it must
never early-return on the flag. Self-terminating via the untouched attempt cap.
This is why `retryReminderEmail` is still live under the flag while
`deliverReminderEmail` is not — don't "tidy" them into one deprecation state.

**How to apply:** flip or roll back OUTSIDE 08:00–13:00 UTC — cleanest right
after a successful summary run. To drain a stranded day, re-enable and
`POST /api/system/notifications/run` with `{"force": true}` (clears
`claimed`/`failed` claims only, never `sent`).

Related: [[gotcha-summarized-at-means-not-eligible]]

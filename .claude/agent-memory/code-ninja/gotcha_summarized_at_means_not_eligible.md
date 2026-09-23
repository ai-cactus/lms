---
name: gotcha-summarized-at-means-not-eligible
description: ReminderLog/ReminderNudge.summarizedAt means "not eligible for a summary", not "was in one" — four writers must keep it right, and INITIAL_LAUNCH is never a summary item
metadata:
  type: project
---

`summarizedAt` on `ReminderLog` / `ReminderNudge` reads as "captured into a cycle
summary", but its real meaning is **"not eligible for one"**. Four writers set it
and all four must agree, or the cutover either double-mails or goes silent:

1. `dispatchLadderStage` — null when `CYCLE_SUMMARY_ENABLED` is on (hand the row
   to the composer), `new Date()` when off (this row already got its own email).
2. `dispatchNudge`'s upsert — same value on **both** `create` and `update`. The
   nudge row persists across sends, so a stamp left over from a previous cycle
   hides every later nudge. Same for `attemptsRemaining`.
3. `createEnrollmentForUser` and the sweep's renewal pre-pass — always stamped.
   Their `INITIAL_LAUNCH` rows are dedup markers, not dispatches: the email is
   the course-launch email those paths send themselves, which the cutover does
   NOT replace. `compose.ts` also excludes the stage outright (belt and braces).
4. The `20260923140000_cycle_summary_cutover` migration backfilled every
   pre-existing row, or the first enabled run would have mailed months of
   history.

**Why:** the composer gathers on `summarizedAt IS NULL` (partial indexes), so
null is a work queue, not a fact about the past.

**How to apply:** any new writer of either table must decide this explicitly.
Leaving it null "because nothing summarized it yet" parks the row in the queue
(and its index) forever and mails its content to someone.

Related: [[project-cycle-summary-cutover-flag]]

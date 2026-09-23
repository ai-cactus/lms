---
name: cycle-summary-pr2-cutover-validation
description: PR2 flag-gated cutover (dispatch.ts/sweep.ts/compose.ts/retry.ts) — two real gaps found via CycleSummaryItem's dedup key lacking recipientRole and the retry stand-down being unconditional; sabotage-proofs added
metadata:
  type: project
---

Validated `feature/cycle-summary-cutover` (PR2, on top of PR1 —
[[cycle-summary-pr1-foundation-tests]]) — the flag-gated cutover that stops
`dispatchLadderStage`/`dispatchNudge` from emailing and turns on
`cycle-summary-worker.ts` (compose + retry) in place of the notification
digest. Full verification green: typecheck, ESLint/Prettier on the touched
test files, full unit suite sharded 4-way (368 files / 6290 tests incl. 2 new),
`npm run build`. e2e NOT re-run — no route/worker/UI surface in this diff;
confirmed `createEnrollmentForUser`'s `INITIAL_LAUNCH` stamping (always
`summarizedAt: new Date()`, unconditional on the flag) is untouched by this PR,
so `tests/e2e/staff-assign-multiple-courses.spec.ts`'s per-enrollment
`reminder_logs` count assertion still holds.

**Two real double/lost-send-adjacent bugs found, NOT fixed (product code):**

1. **Self-escalation retry drops a section.** `resolveEscalationRecipients`
   falls back to "every admin in the org" with NO exclusion of the row's own
   subject — so an admin/HR/owner enrolled in their own required training, with
   no `managerId` set, resolves as their OWN escalation target. compose.ts
   legitimately buckets this row TWICE (once `'worker'`, once `'escalation'`),
   giving the original email both `training_due` and `team_compliance`
   sections (see `compose.test.ts`: "gives a manager who is also a learner ONE
   email holding both section families" — PR1-era, confirmed correct). But
   `CycleSummaryItem`'s unique key is `(emailMessageId, itemType, itemId)` —
   no `recipientRole` column — so `skipDuplicates` collapses the two copies
   into ONE recorded row. `retry.ts` derives `recipientRole` purely from
   `row.workerEmail === candidate.toEmail`, which is true here, so a RETRIED
   send can only ever reconstruct the `'worker'` copy — the `team_compliance`
   copy is silently gone. Sabotage-proof added:
   `retry.test.ts` → "runCycleSummaryRetry — recipient who is their own
   escalation target" (asserts current, buggy `['training_due']` output with
   an inline note of what it should be). Practical severity is LOW: the lost
   content is redundant (the same course, already shown in section 1), so no
   information is actually withheld from the recipient — but it is a genuine
   completeness defect worth a follow-up fix (give `CycleSummaryItem` a
   `recipientRole` column, or dedupe in the app layer instead of at the DB
   constraint).

2. **Cutover permanently orphans any then-unretried failed per-stage email.**
   `sweep.ts`'s `runRetryPrePass` returns immediately when
   `isCycleSummaryEnabled()` (test: "stands down once the cycle summary owns
   delivery" — confirms `emailMessage.findMany` is never even called). The new
   `runCycleSummaryRetry` only selects `kind: CYCLE_SUMMARY_EMAIL_KIND`. So any
   `EmailMessage` row with `kind: 'reminder_stage'`/`'reminder_nudge'` that was
   still `status: 'failed'` (not yet exhausted) at the moment the flag flips ON
   has NO code path that will ever look at it again — it sits at `failed`
   forever. Narrow window in practice (failed <3 days before cutover, given the
   1h backoff + daily sweep + maxAttempts=3), but real and undocumented
   anywhere (not in `.env.example`, not in a code comment) — unlike the
   ON→OFF 08:00–13:00 UTC window, which IS disclosed (see below).

**Verified SOUND (no bug, confirmed by new or existing tests):**

- Nudge fired twice (upsert) resets `summarizedAt` on BOTH `create`/`update` —
  existing test, `dispatch.test.ts` line ~625.
- A `ReminderLog` fanning out to N escalation admins/recipients — retry is
  keyed per-`EmailMessage` (one row per recipient), so a failed send for one
  recipient never re-mails an already-`sent` one — existing test,
  `retry.test.ts` "isolates one recipient failure from the next recipient
  re-send".
- **Compose crashing mid-org after some recipients were stamped/sent** — new
  sabotage test added: `compose.test.ts` → "does not re-mail a recipient
  already delivered before a later recipient crashes the same org" (2
  recipients, 2nd bucket's `$transaction` throws). Confirmed: 1st recipient's
  email sent + row stamped (won't be re-gathered); 2nd recipient's row is
  NEVER stamped (transaction never committed), so it is picked up fresh on a
  later period — no double-send, bounded strand, not lost.
- **Flag ON→OFF between the 08:00 UTC sweep and 13:00 UTC summary**: rows
  claimed while ON are genuinely never re-emailed once OFF (the ladder's P2002
  dedup means they can't re-fire, and the digest worker never touches
  `reminder_logs`). This IS a real, permanent loss of that one email (learner
  still got the in-app notification) — but it is explicitly documented and
  accepted: `.env.example`'s `CYCLE_SUMMARY_ENABLED` comment says exactly this
  and instructs rolling back outside that window. Not a gap; verified the
  claim is accurate.
- **Flag OFF→ON after that day's digest already claimed**: `composeOrganization`
  claims `cycleSummaryRun` FIRST and returns immediately on P2002 before any
  read/write of source rows — confirmed by the existing "skips an organization
  whose period was already claimed (P2002)" test. Rows stay `null`, summarized
  the next period. Late, never lost.
- Retention purge only deletes `status: 'sent'` EmailMessage rows (ages by
  `sentAt`) — a pending retry (`failed`, `attempts < maxAttempts`) can never be
  purged prematurely, for either the old or new `kind`.
- Migration `20260923140000_cycle_summary_cutover`'s watermark
  (`UPDATE ... WHERE summarized_at IS NULL`) is idempotent and correctly
  scoped: it only touches `reminder_logs`/`reminder_nudges`, never
  `email_messages`, so it has no interaction with the sweep's retry pre-pass.
  One operational note (not a bug): if `reminder_logs` has a lot of history,
  this is a one-time UPDATE across every pre-existing row (PR1 added the
  column with no writer, so ALL rows are NULL going in) — fine as a
  deliberate, hand-authored migration, but worth running in a low-traffic
  window on a long-lived production table.

**Minor hygiene note, not tested (low priority):** a per-assignment
`reminderStages` config with `channels` excluding `'email'` (in-app only) still
gets `summarizedAt: null` from `dispatchLadderStage` while the flag is ON
(the null/stamped choice is purely flag-based, not channel-based), but
`gatherReminderRows` filters ladder rows to `channels: { has: 'email' }` — so
that row can NEVER be gathered and its `summarizedAt` NEVER gets stamped by
anything. It just sits `NULL` forever, contradicting the documented invariant
("null = still eligible"). No lost email (none was ever wanted), just
permanent partial-index bloat + a false "still needs a summary" signal. Pre-
existing from PR1's gather-query design, not introduced by PR2.

**Judgement call on the weekly-org Settings copy** (asked, not to fix): the
`NotificationSettingsTab` "Summary Reports" section's Weekly option
description ("Summary sent every Monday morning") is now materially
incomplete post-cutover. Pre-cutover, reminder emails were a fully separate,
uncorrelated stream from this cadence setting, so a savvy admin could
rationalize occasional extra emails as "that's a reminder, not my weekly
summary." Post-cutover, reminders are now baked into the SAME physical
"cycle summary" email template this cadence setting names — so a "Weekly"
admin with outstanding reminders will get that identical-looking email
DAILY, with only the "Organization updates" section actually gated to
Monday. Recommend the copy disclose that training reminders always ship
daily regardless of this setting.

Related: [[cycle-summary-pr1-foundation-tests]]

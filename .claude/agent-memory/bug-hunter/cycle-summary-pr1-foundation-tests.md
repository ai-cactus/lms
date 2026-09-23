---
name: cycle-summary-pr1-foundation-tests
description: PR1 of the unified cycle-summary email (schema + pure modules, NOT wired) — coverage gaps found and closed, shared-table collision risk for PR2
metadata:
  type: project
---

PR1 of the unified cycle-summary email (`src/lib/cycle-summary/{sections,compose,email-sender}.ts`,
migration `20260923120000_add_cycle_summary`) landed on `feature/cycle-summary-foundation` as
schema + pure modules only — confirmed by grep that nothing outside `src/lib/cycle-summary/` and
its own tests imports the new module; `sweep.ts`/`system/notifications/run/route.ts` edits are
inert renames (`NO_ESCALATION_RECIPIENTS`, `prisma.cycleSummaryRun`).

**Why:** this is a foundation-only PR (PR2 does the flag-gated cutover), so the review bar was
"real risk gaps in the new pure modules" rather than "does the feature work end-to-end."

**Gaps found and closed** (added to `src/lib/cycle-summary/compose.test.ts`, describe blocks
"recipient fan-out" and "leftover rows with zero resolved recipients"):
- Fan-out to N escalation admins (not just admins[0]) — sabotage-proved: slicing the recipient
  loop to 1 makes exactly this new test fail (2 expected sends → 1).
- Escalation resolution cached once per learner across multiple outstanding rows
  (`resolveEscalationRecipients` call-count assertion) — exercises the `escalationCache` Map.
- Fan-out to N role-routed recipients (multiple admins with one routed event).
- One recipient with 2+ reminder rows landing in ONE email with all sections populated
  (`itemCount`, both `training_due`/`training_upcoming` items present) — previously only tested
  with one row per recipient at the compose level (sections.ts had it, compose.ts didn't).
- A reminder row whose only audience is escalation-only (`HARD_ESCALATION`) but
  `resolveEscalationRecipients` returns zero members: the row must still be stamped by the
  org-level "leftover" mop-up query (it lands in zero buckets, so the per-bucket transaction never
  touches it) — and must NOT be stamped in dry-run (dry-run returns before the mop-up code runs at
  all, so this is a regression guard against that early-return ever moving).

**What was already well covered** (no gaps): org-scan UNION, manager-is-also-learner (sections
1+3, no suppression), actor-exclusion on notification events, weekly-org Monday-only gating while
reminders still flow daily, realtime-org `isDue` reasoning (drains stranded pending events from a
daily→realtime switch), claim-race P2002, `cycleSummaryItem.createMany skipDuplicates`, dry-run
zero-writes, `sendCycleSummaryEmail` NOT double-recording via `sendMailTracked` (explicit test:
"does NOT record its own EmailMessage row").

**WORKER_RETAKE → section 1 (due), not section 2 (upcoming):** agreed as correct. The retake is
outstanding work right now (fired after a failed attempt), independent of the enrollment's
original deadline — grouping it as "due" avoids implying it can wait. `attemptsRemaining` is never
populated by the real compose pass (it's not stored on `ReminderNudge`); `sections.ts` already
documents the degraded "Quiz retake available" copy as intentional, not a bug.

**PR2 planning risk (not a PR1 defect):** `digest.ts` (still the live, wired notification-digest
path) and the new `compose.ts` (not yet wired) both claim rows in the SAME renamed table
(`cycle_summary_runs`) keyed on `(organizationId, periodKey)`. For a DAILY organization both
compute the identical key shape (`daily:YYYY-MM-DD`), so if both systems are ever live
concurrently during the PR2 cutover window, whichever claims first blocks the other for that
org/day. Also: `prisma/notification.prisma`'s `CycleSummaryRun` doc comment claims "nothing reads
or writes that [weekly] shape any more" — false as of PR1, since `digest.ts` still writes
`weekly:2026-Www` claim rows under the new table name until PR2 cuts over. Minor doc-accuracy
issue, flagged not fixed (comment-only, still out of scope to touch product code for this review).

Full verification for this PR: `npm run typecheck` clean, `npm run build` succeeds, full unit
suite sharded 4-way (`--shard=N/4 --maxWorkers=1`, see [[full-vitest-run-ooms-here]] equivalent in
code-ninja's memory) — 365 files / 6237 tests, 0 failures, including the 8 new tests. ESLint clean;
Prettier needed one `--write` pass on the new test additions (unified diff had already-correct
logic but slightly off formatting).

---
name: video-courses-missing-diagnostic-2026-09-08
description: Read-only diagnostic of "no video courses appear anywhere" on staging. Catalog data ruled healthy; later resolved as a FALSE ALARM (wrong tab). Kept: the /system/video-courses sanity check and read-only diagnostic discipline
metadata:
  type: project
---

**Full report:** `qa-reports/2026-09-08-staging-video-courses-missing.md`. This was a **read-only diagnostic** (explicitly no create/delete/assign/change) to discriminate between two causes for a reported bug: "no video courses appear anywhere, though files exist in storage."

**Verdict:** Cause B (broken or missing catalog data) was RULED OUT. This run leaned towards a billing-gate cause, but the report was later resolved as a **FALSE ALARM: the reporter was looking at the wrong tab** (orchestrator memory `video-course-visibility-architecture`). The billing gate (`hasActiveBilling`) is real and silent, so keep it in mind. But check which tab the reporter was on before chasing a gating theory.

**`/system/video-courses` (system-admin, no billing gate, no org scope) is the fastest way to sanity-check "is the catalog itself broken" independent of any org's billing state.** As of 2026-09-08: 7 global video courses, all `Status: Ready` (fully processed), 6 `Active` + 1 `Inactive` (a deliberately-named `[QA FIXTURE] Do Not Assign` throwaway from a prior round — not a regression). "Orgs" (adoption count, 0–2) and "Enrolled" (0–6) columns show real recent usage (as recent as the day before this test). Use this table as the ground-truth "is the data fine" check before chasing an org-specific billing/rendering theory.

**A known EXISTING unsubscribed org on staging — "Bravo Tenant Health LLC", owner `theraptlyqa+xorgb-0821@gmail.com` (created during the 2026-08-21 cross-org probe, `qa-reports/2026-08-21-cross-org-probe.md`) — is documented as having NO active billing plan** (`GET /api/auditor/export` → 402 "requires a billing plan", `POST .../start` → 403 "Auditor access not enabled", both from that date). This is the ideal fixture for directly reproducing the empty-Video-tab symptom in a future round — **but its password is not recorded**, and none of the known QA password conventions worked against it as of 2026-09-08. To use it, reset its password via forgot-password + IMAP (only when the task permits mutations), or create a fresh deliberately-unsubscribed org.

**Billing plan-card "Price unavailable" (all 9 cells) — reported earlier the SAME DAY in [[staging-claim-verification-2026-09-08]] as a "blanket failure" — did NOT reproduce in this later same-day run.** All 9 Starter/Growth/Pro × Yearly/Quarterly/Monthly cells resolved to real numbers (Yearly $80/$200/$400, Monthly $100/$250/$500, Quarterly Starter $88/mo). This is consistent with that memory's own hypothesis that it was a **transient stale-`unstable_cache` result right after a fresh deploy** (self-healing, ~1hr TTL) rather than a persistently-unset `STRIPE_SECRET_KEY` (which would not self-heal without an env fix). If a future round sees "Price unavailable" again, note the exact time-of-day relative to the last deploy — that's the discriminating signal between the two theories.

**Read-only-diagnostic discipline note:** when a task explicitly says "do not create/change anything" and the ideal fixture to prove a claim requires either creating new data OR resetting an existing account's password, both are out of bounds — report the gap as BLOCKED with the reasoning, don't work around it. A failed login attempt itself is not a mutation and is safe to try a few known password candidates before giving up.

See [[staging-two-facility-fixture-recipe]], [[team-test-round-2026-09-03]], [[staging-claim-verification-2026-09-08]], [[admin-courses-list-redesign]], [[billing-subscription-patterns]] for related background.

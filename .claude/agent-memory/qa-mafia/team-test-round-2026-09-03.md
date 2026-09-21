---
name: team-test-round-2026-09-03
description: Early-September B4 staging rounds (PR #580, plus the 09-04 #582/#584 follow-ups merged in) — B4 fixture roster, deferred-pause/past-date coverage gaps, 16x watch-through, double-delete race and keyboard-tab techniques
metadata:
  type: project
---

**Full report:** `qa-reports/2026-09-03-staging-team-test-round.md`. Verdict: PASS WITH RISKS across all 9 stories (33/36 criteria PASS, 3 BLOCKED by genuine fixture/product-design gaps, zero FAIL).

**The "QA B4 Multi-Facility Org LLC" fixture is a durable, reusable multi-facility test org** (first built 2026-08-29, still alive and current as of 2026-09-03 — staging DB is NOT reset between deploys). Owner `theraptlyqa+b4owner@gmail.com`. As of this date it has: 2 facilities (Facility 1 - Manhattan Clinic, Facility 2 - Brooklyn Clinic), 5 published video courses, a Starter/Yearly Stripe subscription (renews Aug 30, 2027), and 10 staff: Owner, F1 Supervisor (`+b4f1sup`), F2 Supervisor (`+b4f2sup`), F1 Worker (`+b4f1worker`, Therapist/Clinician), F2 Worker (`+b4f2worker`, Nurse), w1-w4 (`+b4s565w1..w4`, all Nurse, Facility 1), plus a Finance account added this round (`+b4t0903finance`). Passwords drift across rounds as QA sessions reset them via IMAP. For current credentials and the fallback procedure, see [[staging-two-facility-fixture-recipe]], which also has the original build recipe.

**CONFIRMED FIX — Story 2 (highest priority): a MANAGER-role user (Facility Supervisor tested) now sees "Attest" alongside "Done" after passing a course, reached via the sidebar Manage/Learn toggle → `/worker`.** This is the third time this exact symptom has been fixed; still has zero automated e2e coverage per the brief. Live-verified end-to-end including a completed attestation + real certificate issuance, not just the results-screen label. Plain-worker regression also re-confirmed clean in the same run.

**CONFIRMED FIX — Story 3: supervisor audit-reports export (`/api/auditor/export/start` and the download) no longer 403s.** Also, the previously-documented "polling never fires, stuck on Preparing…forever" bug (see [[billing-subscription-patterns]]'s Phase-4 note) did **not** reproduce this round — the UI's own completion banner + "View Report" download worked cleanly on the first attempt. Facility-scoping of the KPI cards, course-catalogue counts, and the "Facility Staff" (vs owner's "All Staffs") heading all confirmed correct.

**Two genuine, disclosed coverage gaps — both caused by the product deliberately having no in-UI way to create a past-dated state:**
1. **Pausing a subscription is ALWAYS deferred to the current billing period's end** (confirmed live via the pause dialog's own copy: "The pause starts on [period end]... nothing changes before then"). There is no way to reach an immediately-in-effect "paused" (vs "pause-scheduled") state without DB manipulation or waiting for the real period to elapse. Matches the "deferred pause" product decision noted in the orchestrator memory `product-decisions-2026-08-27` (dated 2026-08-27, still true 2026-09-03).
2. **The course-assign due-date calendar has genuinely disabled past dates** (verified live: today's date and yesterday's are both `disabled` buttons in the calendar widget) — there is no in-UI way to create a 7-day-overdue enrollment (needed for the `StatusTrackerAlertBanner` hard-escalation banner) without DB manipulation or waiting 7 real days. This blocked live-verifying the two-banner (`BillingPausedBanner` + `StatusTrackerAlertBanner`) stacking/spacing case directly — had to rely on strong code-level evidence instead (`src/components/dashboard/banner-shell.ts`'s shared `DASHBOARD_BANNER_SHELL` constant, used verbatim by both banner components) rather than a live screenshot of both banners stacked.

**Certificates date-filter ("Nothing in this date range" copy) has the same class of gap**: only 3 presets exist (Last 7 days / Last 30 days / All time, no custom range), and every certificate in the fixture org is <7 days old — there is no way to force a zero-match filtered state live without an intentionally aged-out certificate fixture. If a future round needs this, seed a certificate with an `issuedAt` weeks in the past via DB, or wait out real time.

**Reusable technique confirmed again — real video watch-through at 16x speed + waiting for a genuine `ended` event:**
```js
await v.evaluate(el => { el.muted = true; el.playbackRate = 16; el.play(); });
await v.evaluate(el => new Promise(resolve => {
  if (el.ended) return resolve('already-ended');
  el.addEventListener('ended', () => resolve('ended'), { once: true });
}));
```
Works reliably via `playwright-cli run-code --raw`. See [[watch-through-gate-testing]] and [[learner-view-quiz-and-picker-patterns]] for the fuller quiz-answering playbook — the "Technology and Cybersecurity Training" course's exact 5 Q&A pairs are now known-correct across two independent QA rounds (2026-08-31 and 2026-09-03), and "Unique Needs of Persons Served 1"'s 6 Q&A pairs are newly confirmed this round.

## Techniques carried over from the 2026-09-04 follow-up rounds (PR #582 / #584)

Every finding from those two rounds has since been fixed or superseded:
- The Duplicate feature was removed in `b952373e` (#587).
- The seat count now frees on removal (`de25ee93`).
- The course title has a tooltip (`8ac08b0a`).
- `removeStaff` now retains all enrollments (`243375f4`).

What stays reusable:

**Forcing a genuine "double delete" race with no tooling, to prove a refusal path is readable.** Open the same row's delete-confirm dialog in two separate `playwright-cli` sessions: two logged-in accounts, or one account in two tabs. Confirm in one first, then confirm the now-stale dialog in the other. This reproduces the server's "not found" branch live (for courses: "Course not found.", with no #441) and needs no direct DB or API calls. Use it whenever a "was this refusal message user-friendly" criterion needs a forced-failure branch.

**Keyboard-only tab reachability.** Run `page.getByRole('link', {name:'Back'}).focus()` via `run-code`. Then press Tab N times, reading `--raw eval "() => document.activeElement.outerHTML.slice(0,200)"` after each press. This shows whether each pill is its own `<button role="tab">` Tab stop. Then `press Enter` should flip `aria-selected` and swap the tabpanel.

**Verify native `title=` tooltips via DOM `eval`, not hover screenshots.** Native tooltips don't screenshot reliably.

**IMAP gotcha.** Plain (non-`UID`) `SEARCH` returns SEQUENCE numbers, not UIDs. Use `UID SEARCH` before fetching by `;UID=<n>`, or the wrong message gets fetched. See [[qa-gmail-imap-quirks-and-ui-bypass-technique]].

See [[staging-two-facility-fixture-recipe]], [[rbac-role-grant-matrix]], [[audit-reports-patterns]], [[billing-subscription-patterns]], and orchestrator memory `product-decisions-2026-08-27` for related background.

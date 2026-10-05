---
name: dashboard-facility-consistency-investigation-2026-09-24
description: Facility-scope switcher mechanics (modal, additive-chip trap, badge quirk) — the number mismatches this investigation originally recorded were FIXED by PR #689 and retested 2026-09-28, see [[dashboard-metric-definitions-retest-2026-09-28]]
metadata:
  type: project
---

**Context:** originally a founder-requested read-only investigation (2026-09-24) into the B4 owner dashboard's Global-vs-single-facility number mismatches. **All three contradictions it recorded (Facility 1 staff-count 8-vs-5, Facility 1 completion 12%-vs-0%, Facility-2 Status-Tracker badge 1-off) were fixed by PR #689 and confirmed fixed in the 2026-09-28 retest — see [[dashboard-metric-definitions-retest-2026-09-28]] for the current state and the one new defect (a legend mislabel) found instead.** What remains here is switcher UI mechanics, still current as of 2026-09-28.

**The facility-scope switcher is a modal (not a plain `?facility=<uuid>` link).** On `/dashboard` (or `/dashboard?facility=...`), the "Facility scope: …" button opens a **"Switch facility scope" MODAL DIALOG** with a search combobox, three quick-filter chip buttons ("All facilities" / each facility name), and a multi-select listbox with an apply button ("Select N facility/facilities"). Applying navigates to `/dashboard?facility=<uuid>` (or a comma-joined `uuid1,uuid2` for comparison mode) via a real server round trip: `GET ...&_rsc=...` then `POST /dashboard?facility=<uuid>` (Server Action) then RSC re-render — confirmed NOT client-side filtering.

**UX trap: the quick-filter chips are additive toggles, not radio buttons.** If Facility 1 is already selected from a prior visit and you click the "Facility 2" chip, both end up selected ("Select 2 facilities") — you must explicitly click the Facility 1 *listbox option* (not the chip) to deselect it before applying a genuine single-facility view. Any QA/dev clicking through this modal should verify the apply-button's facility count before hitting "Select N facility/facilities". (Note: this trap only bites when a prior selection is already active — a fresh page load starts with nothing selected.)

**Modal's per-facility completion-% badge is state-dependent:** opening the modal from the Global page shows live badges; re-opening the same modal from an already-scoped `?facility=...` page shows **"—" for both options** instead of a percentage. Looked like a stale/not-refetched value, not confirmed as a bug.

**Comparison mode (both facilities selected) is a genuinely distinct code path**, confirmed by distinct microcopy ("Comparing N of N facilities" / "Showing N of N selected facilities") vs the default all-facilities view's copy ("Performance overview across all facilities" / "Showing 1 to N of N facilities") — not just a relabeled default.

**Methodology note:** courses tables on the facility-scoped dashboard truncate to 5 of 7 rows (there's a working "View all" link) — don't mistake the truncated table for the full picture when reconciling against the DB; use the "Total Courses"/"Total Active Courses" tile or the 7-bar Performance-of-Learners chart for the full course list instead. `/dashboard/training` (org-wide "Training Dashboard") shows the full course list untruncated, useful when you need all rows without pagination.

See [[staging-two-facility-fixture-recipe]], [[dashboard-scoping-fix-2026-09-14]] for the underlying fixture and the two-dashboard-template architecture this switcher sits on top of, and [[dashboard-metric-definitions-retest-2026-09-28]] for the current pass/fail state of the actual figures.

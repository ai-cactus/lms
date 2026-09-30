---
name: dashboard-metrics-glossary
description: Glossary (PDF gone) governs Risk Level / Audit Readiness; the founder's 2026-09-26 definitions govern the tiles, counted in lib/dashboard/definitions.ts; two alignment-pass decisions still need sign-off
metadata:
  type: project
---

The "Theraptly LMS — Dashboard Metrics Glossary (Standardized)" came from `multi_facility_notes.pdf`, which is **no longer in the repo** (it was never tracked; ask the user for it if you need the original). Its code-side record is the §-references in `src/lib/facility/metrics.ts`. Sections: §0 canonical terms, §0.1 Risk Level, §0.2 Audit Readiness, §0.3 time windows. It is the single source of truth for metric names/definitions across the Manager Dashboard, Priority Risks, Facility Overview, Status Tracker and Audit Report Overview.

**Why:** the QA notes in that PDF (DASH-001/002/003) flagged duplicate labels and undefined Risk Level / Audit Readiness; the glossary was written to retire the old names for good.

**How to apply:** when touching any dashboard metric, take the label and the formula from the glossary rather than from the surrounding screen. Two judgment calls made during the 2026-08-11 alignment pass are still unconfirmed with product:

1. Facilities Overview still shows an on-time-completion percentage above the Audit Readiness chip. The glossary defines Audit Readiness as pass/fail with failing criteria listed, not a percentage — the number was kept because removing it was outside the alignment scope.
2. §0.2's fourth criterion (required documentation on file for all active staff) is deliberately unscored: nothing in the schema tracks it. Likewise "Offboarded Staff" has no card because offboarding is not modelled yet.

The founder's dashboard definitions + rulings of 2026-09-26 now govern every dashboard TILE (names, populations, windows); how each is counted lives in `src/lib/dashboard/definitions.ts`, and the help text in `METRIC_DEFINITIONS` must match it. Credentials are certificate-based: expiry = `Certificate.issuedAt` + the assignment's renewal cycle, superseded only by a LATER completed enrolment for the same member+course.

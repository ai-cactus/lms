---
name: dashboard-metrics-glossary
description: The Dashboard Metrics Glossary (from a product PDF no longer in the repo) is canonical for dashboard metric names/formulas; code-side record is src/lib/facility/metrics.ts; two alignment-pass decisions still need product sign-off
metadata:
  type: project
---

The "Theraptly LMS — Dashboard Metrics Glossary (Standardized)" came from `multi_facility_notes.pdf`, which is **no longer in the repo** (it was never tracked; ask the user for it if you need the original). Its code-side record is the §-references in `src/lib/facility/metrics.ts`. Sections: §0 canonical terms, §0.1 Risk Level, §0.2 Audit Readiness, §0.3 time windows. It is the single source of truth for metric names/definitions across the Manager Dashboard, Priority Risks, Facility Overview, Status Tracker and Audit Report Overview.

**Why:** the QA notes in that PDF (DASH-001/002/003) flagged duplicate labels and undefined Risk Level / Audit Readiness; the glossary was written to retire the old names for good.

**How to apply:** when touching any dashboard metric, take the label and the formula from the glossary rather than from the surrounding screen. Two judgment calls made during the 2026-08-11 alignment pass are still unconfirmed with product:

1. Facilities Overview still shows an on-time-completion percentage above the Audit Readiness chip. The glossary defines Audit Readiness as pass/fail with failing criteria listed, not a percentage — the number was kept because removing it was outside the alignment scope.
2. §0.2's fourth criterion (required documentation on file for all active staff) is deliberately unscored: nothing in the schema tracks it. Likewise "Offboarded Staff" has no card because offboarding is not modelled yet.

Credential metrics are a proxy, not real credential records: an enrollment whose assignment carries a renewal cycle. Expired = renewal deadline passed with no completion.

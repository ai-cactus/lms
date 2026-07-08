# Status Tracker rename + dashboard widget — Design

**Date:** 2026-07-08
**Branch:** `feat/status-tracker`
**Status:** Approved by user

## Goal

1. Rename the admin "Compliance" page to **Status Tracker** — in the nav menu label, the URL (`/dashboard/compliance` → `/dashboard/status-tracker`), and all code identifiers (full-depth rename).
2. Add a **Status Tracker overview section** (counts + top-5 overdue list) to the bottom of the admin dashboard.

## Decisions (confirmed with user)

- **Old URL:** no redirect. Code references are updated; there are no stored notification rows or sent-email links in the DB yet, so `/dashboard/compliance` may 404 after the rename.
- **Widget shape:** summary counts (overdue, hard escalations) **plus** a compact list of the 5 most-overdue workers, with a "View all" link to `/dashboard/status-tracker`.
- **Placement:** bottom of the admin dashboard page, after the Available Courses table.
- **Rename scope:** full — components, files, types, and identifiers are renamed, not just user-facing strings.
- **Unchanged wording:** the in-app notification title `Compliance escalation` (`dispatch.ts`) and the alert-banner headline "Training overdue — action needed" stay as-is; they describe the event, not the page. Only link targets change.

## Part 1 — Full rename

| Current | New |
| --- | --- |
| `src/app/dashboard/(main)/compliance/page.tsx` | `src/app/dashboard/(main)/status-tracker/page.tsx`; component `CompliancePage` → `StatusTrackerPage`; metadata title `Status Tracker \| Theraptly LMS`; h1 "Status Tracker" (description line about overdue training kept) |
| `src/components/dashboard/compliance/ComplianceTableClient.tsx` | `src/components/dashboard/status-tracker/StatusTrackerTableClient.tsx`; exported type `ComplianceRowView` → `StatusTrackerRowView`; component `ComplianceTableClient` → `StatusTrackerTableClient` |
| `src/components/dashboard/ComplianceAlertBanner.tsx` | `src/components/dashboard/StatusTrackerAlertBanner.tsx`; component renamed; CTA link → `/dashboard/status-tracker` (headline text unchanged) |
| `src/lib/reminders/compliance.ts` | `src/lib/reminders/status-tracker.ts`; `ComplianceRow` → `StatusTrackerRow`; `ComplianceSummary` → `StatusTrackerSummary`; `getOverdueComplianceForOrg` → `getStatusTrackerSummaryForOrg` |
| `src/lib/reminders/compliance.test.ts` | `src/lib/reminders/status-tracker.test.ts` (imports/names updated) |
| `src/lib/reminders/email-sender.ts` | `COMPLIANCE_LINK` → `STATUS_TRACKER_LINK = '/dashboard/status-tracker'` |
| `src/lib/reminders/dispatch.ts` | `linkUrl: '/dashboard/status-tracker'` (notification title unchanged) |
| `src/components/dashboard/DashboardLayoutClient.tsx` | Nav label "Status Tracker"; `href` and `pathname.startsWith` → `/dashboard/status-tracker`; keep `ShieldAlert` icon |
| `src/app/dashboard/(main)/layout.tsx` | Updated imports/usages of renamed banner + summary function |
| `src/lib/reminders/sweep.ts` | Comment references to the compliance page/function updated |
| `tests/e2e/reminders.spec.ts` | `page.goto('/dashboard/status-tracker')`; test names/assertions referencing the compliance page updated |

Also sweep for any remaining `dashboard/compliance` string references after the move.

## Part 2 — Dashboard Status Tracker overview

New component `src/components/dashboard/status-tracker/StatusTrackerOverview.tsx` (presentational; receives serialized summary data from the server page):

- Section header "Status Tracker" with a "View all →" link to `/dashboard/status-tracker`.
- Two summary chips: **Overdue training** count and **Hard escalations (7+ days)** count — the escalation count uses `text-error` when > 0 (mirrors the full page).
- Compact table/list of the **top 5** rows from the summary (already sorted most-overdue-first): worker name, course title, due date, days overdue.
- Empty state: slim "All caught up — no overdue training" card so the section stays discoverable.
- Styling: Tailwind v4 + theme tokens, responsive, consistent with the existing dashboard cards. `lucide-react` icons only.

Data flow in `src/app/dashboard/(main)/page.tsx`:

- Extend the existing `prisma.user.findUnique` select with `organizationId`.
- Fetch `getStatusTrackerSummaryForOrg(orgId)` — added without creating a sequential waterfall (the user lookup already runs inside `Promise.all`; the summary fetch follows it since it needs `organizationId`, or the page can select the org id from the session-scoped query it already performs).
- Render `<StatusTrackerOverview …/>` after `<AvailableCoursesTable/>`. Dates serialized to ISO strings across the server/client boundary (same pattern as the full page).
- The dashboard page is already admin-only (workers are redirected to `/worker`), so no extra gating is needed.

## Testing

- Rename + update `status-tracker.test.ts` (behavior unchanged — pure rename).
- Update `tests/e2e/reminders.spec.ts` for the new URL/labels.
- Add coverage for the dashboard overview (top-5 slicing, empty state) per bug-hunter's risk assessment.

## Out of scope

- No redirect from the old URL.
- No rename of unrelated "compliance" domain code (AI prompt schemas, audit reports, course categories, PHI scanner).
- No change to reminder sweep/escalation behavior.

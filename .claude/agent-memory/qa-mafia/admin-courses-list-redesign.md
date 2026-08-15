---
name: admin-courses-list-redesign
description: Current (2026-08) /dashboard/courses admin list UI shape — Video/Reading Course tabs, row actions, empty/no-match states, seeded QA fixtures
metadata:
  type: reference
---

**Route:** `/dashboard/courses` (admin), component `src/components/dashboard/courses/CoursesListClient.tsx`. This superseded the older "My Courses" / "Available Video Courses" tab UI referenced in [[courses-billing-gate]] — that memory's *UI shape* details (tab names, "Slides" label) are stale; its billing-gate mechanics may still be relevant but were not re-verified this run (both seeded QA orgs already had active paid plans, so the paywall didn't fire).

**Tabs:** exactly `Video` and `Reading Course`, each with a `rounded-full` count badge. Active tab: `border-primary`/`text-primary`; inactive: `text-[#5d5d5d]`. Switching tabs resets pagination to page 1 (verified: page-2 state does not survive a tab round-trip, even switching back to the same tab).

**Columns differ by tab:** Video = Course Name | Assigned Staff | Description | Action (thumbnail exactly 78×47px with a Lucide `play` badge overlay). Reading Course = Course Name | Assigned Staff | Date Created | Action (icon tile exactly 40×40px, `/images/icon-course-blue.svg`). Neither tab has `Type` or `Role` columns.

**Row kebab menu** items are conditional: base set is `Assign to staff`, `Rename`, `Delete` (Delete has `data-variant="destructive"`). `View Source Document` is inserted between `Assign to staff` and `Rename` **only** for courses that actually have a linked source document — in the seeded pagination-org fixture only 2 of 16 reading courses have one ("Infection Prevention and Control", "Incident Reporting and Documentation"); none of the 6 video courses do. No `Duplicate` item exists anywhere. Row click (anywhere in the Course Name cell) navigates to `/dashboard/training/courses/<id>`; clicking inside the Action cell (kebab/View area) does not navigate — isolation works cleanly.

**Empty states:** the org-wide `+ Create Course` header button is gated by `hasCourses && canCreateCourse` where `hasCourses = courseList.length > 0` is computed over the *full unfiltered* course list (not the active tab, not affected by search) — so it only disappears when the org truly has zero courses of either type, and reliably persists during a no-match search. The illustrated empty panel (`/images/courses-empty-state-document.svg`, 154×154) with copy "No video courses yet." / "No reading courses yet." + two CTAs (secondary tab-switch button, primary "Create your first course") only renders when a tab itself is empty — it correctly preserves the card/tabs/search chrome around it (not a whole-widget swap).

**No-match search state is visually and structurally distinct from the empty-tab illustration**: it's a single `<tr><td colspan="4">` inside the existing `<table>` (headers stay visible) with a small inline SVG (120×100, magnifying-glass-over-document, NOT the same asset as the big illustration) and text "No courses found." / "Try adjusting your search or create a new course."

**Pagination footer:** "Showing X to Y of Z entries" + Previous/page-number/Next buttons + a shadcn `Select`-based "Show [5/10/20] entries" combobox (not a native `<select>` — must click to open, then click the `option` role item, not use `select` command).

**Responsive:** at ~375px, `Assigned Staff`/`Date Created` columns collapse out of the header entirely and get folded into a secondary text line under the course title (e.g. "0 assigned · Jul 28, 2026"); confirmed no horizontal scrollbar (`document.documentElement.scrollWidth === clientWidth`). Full columns return at 768px+.

**Minor recurring a11y gap:** the Rename dialog (and likely other dialogs app-wide, per prior QA memory) fires a Radix `Missing Description or aria-describedby for DialogContent` console warning — cosmetic/non-blocking, not a functional defect.

**Seeded QA fixtures (2026-08, `scripts/seed-qa-orgs.ts`, idempotent):** `qa.admin@paginationqa.test` / `QaPagination123!` — org "QA Pagination Org" (enterprise plan), 6 video + 16 reading courses, 32 staff, good for pagination/search/menu-variety testing. `qa.admin@emptyqa.test` / `QaEmptyOrg123!` — org "QA Empty Org" (starter plan), 0 courses, admin only — good for the fully-empty-state case. Both orgs already have active paid subscriptions, so [[courses-billing-gate]]'s paywall did not block "Create your first course" navigation from either account.

---
name: course-list-status-thumbnails-validation
description: Validated the course-list-status-thumbnails branch (CourseThumbnail/CourseListStatusBadge extraction) — audit-reports needs organizations.has_auditor_access flipped locally to screenshot it, and Playwright fullPage screenshots silently truncate at the app shell's inner scroll container
metadata:
  type: project
---

Full-branch validation (2026-09-22) of `src/lib/course/course-list-status.ts` +
`CourseListStatusBadge.tsx` + `CourseThumbnail.tsx` (reading tile = dark `#1c213d` tile with
`NotebookText`, always drawn for non-video regardless of any `thumbnail` url; video = 78x47 `row` /
40x40 `compact` frame with teal `#2c8f88`/40% wash + play-button overlay, wash only applied when
real artwork exists). Consumers swapped to it: `CoursesListClient`, `MyCoursesTable`,
`TrainingDashboard`, `AuditorCoursesTab`, `StaffProfileClient` enrollments table, and
`getAuditorCourses` (`src/app/actions/auditor.ts`) now selects+returns `type`. Full unit suite
354 files / 5969 tests green, `npm run build` green, targeted e2e (10 specs, 48 run / 10
pre-existing self-skips) green. No product bugs found — see also [[courses-list-figma-redesign-tests]]
for the CoursesListClient-specific history (tab label has moved twice; always re-check the live
`TabsTrigger` text before trusting a memory's exact string).

**`/dashboard/audit-reports` is billing-gated behind `organizations.has_auditor_access`
(boolean column, default `false`), not a Stripe plan tier** — the e2e seed org
(`e2e-test-org`) never sets it, so the page renders "Billing required for reports" for every
e2e run and local login. To visually validate `AuditorCoursesTab` live (rather than only via its
component test), flip it directly:
```sql
UPDATE organizations SET has_auditor_access = true WHERE slug = 'e2e-test-org';
-- ...screenshot...
UPDATE organizations SET has_auditor_access = false WHERE slug = 'e2e-test-org'; -- restore the default
```
This is a pure local-DB toggle with no Stripe side effect — safe against the e2e Postgres
container, never do this against `lms` (dev) or any staging/prod database.

**Playwright `page.screenshot({ fullPage: true })` silently truncates on this app's dashboard
shell.** The shell wraps the routed page in an inner `overflow-y: auto` pane (not natural
document flow), so `document.documentElement.scrollHeight` stays pinned to the viewport height
and a `fullPage` capture cuts off exactly at the viewport edge — on `/dashboard/audit-reports`
and `/dashboard/staff/[id]` this silently dropped the entire table below the KPI cards/profile
header, with zero error. Fix: after the page settles, find the tallest element whose computed
`overflow-y` is `auto`/`scroll` and whose `scrollHeight > clientHeight`, then
`setViewportSize({ height: thatScrollHeight + margin })` *before* taking the `fullPage`
screenshot. `/dashboard/courses` was NOT affected (its content sits in normal flow), so this
bites inconsistently per-route — always sanity-check a `fullPage` capture's bottom edge before
trusting it shows the whole page, especially on any dashboard-shell route.

**MCP `mcp__playwright__browser_*` tools were unusable in this sandbox** (`Chromium
distribution 'chrome' is not found at /opt/google/chrome/chrome`, and `npx playwright install
chrome` needs interactive sudo, which fails headless). Fallback: drive the project's own
`playwright` npm dependency directly from a small `.mjs` script — `chromium.launch()` against
the already-installed `~/.cache/ms-playwright/chromium-*` build works fine. A `pg` Client script
or the `playwright` script must live inside the project tree (not the scratchpad) for ESM
package resolution to find `node_modules`; copy in, run, then `rm` it before finishing — never
leave a `scratch-*.mjs` in the repo root.

Seeded extra courses for the visual check under a `'VISUAL CHECK — %'` title prefix directly
against the e2e Postgres via `pg` `Client` (org id resolved by `organizations.slug =
'e2e-test-org'`, `createdByOrgUserId` from an existing `'owner'`-role `organization_users` row —
that column is NOT NULL). `enrollments` has no `created_at`/`updated_at`; the required timestamp
column is `started_at`. Deleted the fixture rows again before finishing (title-prefix match, FK
order: enrollments then courses).

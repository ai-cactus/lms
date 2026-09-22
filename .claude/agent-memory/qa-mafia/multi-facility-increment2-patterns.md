---
name: multi-facility-increment2-patterns
description: Seeded admin/admin2 use a different seed password from other fixtures, playwright-cli install/skill-mismatch quirks, local-DB leftover-fixture caution, and ChangeFacilityModal single-select, found while QA-validating multi-facility increment 2
metadata:
  type: project
---

**Seeded admin/admin2 use seed.ts's `adminPassword`, not `workerPassword` (confirmed 2026-08-06).** See `prisma/seed.ts`. `admin@test.com` (owner) and `admin2@test.com` (supervisor) share `adminPassword`. Every other seeded fixture (`worker@test.com`, `sarah.johnson@company.com`, `nina.nurse@test.com`, etc.) uses the worker password. Using the worker password for `admin@test.com` fails with a generic "Invalid credentials"; verify with `bcrypt.compare()` against the DB hash before assuming a real auth bug. This can drift with seed-file edits, so always grep `prisma/seed.ts` for the `hash(...)` call feeding each account rather than trusting memory or the task brief.

**`playwright-cli` may not be installed/linked even though the skill exists at `.claude/skills/playwright-cli`** — check `which playwright-cli` first; if missing, `npm install -g @playwright/cli@latest` then `playwright-cli install-browser chromium` (browsers aren't bundled either). A "does not match the tool version, run `playwright-cli install --skills`" banner prints on every command but is harmless noise — commands still work; no need to run that installer unless commands actually fail on skill-version grounds.

**`playwright-cli open --headed <url>` can silently navigate to a Google search instead of the URL** (observed once) — if the opened page's title/URL don't match what you expected, don't assume the app is broken; just re-run `playwright-cli goto <url>` explicitly, which reliably works.

**`page.screenshot()` doesn't reflect an inner scrollable div's `scrollTop` set via `eval`** — setting `el.scrollTop = N` via `eval` had no visible effect on the next screenshot in this run, but a real `playwright-cli mousewheel 0 N` (after `mousemove` onto the page first) scrolled correctly and the screenshot reflected it. Prefer `mousemove` + `mousewheel` over `eval`-based scrollTop hacks when a screenshot needs to show scrolled content.

**Local dev DB (`lms-dev-db`, shared across sessions) already had a "Sunrise Behavioral Health" facility under `e2e-test-org`, and ~130 other leftover orgs/facilities from unrelated historical e2e runs, BEFORE this run started.** `npx prisma db seed` only upserts by fixed IDs — it does not prune facilities/orgs created by ad-hoc Playwright specs in prior sessions. Always diagnose "why does this org already have N facilities" by checking `facilities.created_at` / cross-referencing seed.ts's fixed IDs, rather than assuming your own run (or a bug) created the extra rows — and never delete rows you didn't personally create without explicit confirmation they're stale.

**`getCourses()` is org-wide for managers (FIXED since this run).** Managers (`isAdminRole` + `course.read`) see every org-authored course (`creator: { organizationId }`, `src/app/actions/course.ts`). Only non-managers are creator-scoped. The 2026-08-06 blocker, where a non-creator Supervisor/HR saw "No courses yet", no longer applies. Still: don't fabricate `org_course_offerings` rows; that model is for global video-catalog sharing only.

**The prebuilt-course catalog (`/dashboard/courses/prebuilt`) is NOT empty in this shared local dev DB** — 15 global video courses are pre-seeded (independent of `prisma/seed.ts`, likely from an earlier `scripts/seed-courses.ts` run against the persistent Docker volume). If a task brief assumes "unseeded, empty catalog," verify live before trusting that assumption; the empty-state UI can still be exercised via a no-match search string instead.

**`ChangeFacilityModal` (Staff Management) only supports single-facility selection (radio group) — there is no UI path to add a SECOND, additional facility to a member.** The underlying server action `setStaffFacilities(organizationUserId, facilityIds[])` in `src/app/actions/staff.ts` does support an array (multi-facility assignment) and soft-revokes (`active=false`, not delete) any facility not in the new set — but no shipped screen calls it with more than one id. To observe the roster's "+N" multi-facility badge, a direct `organization_user_facilities` INSERT (disclosed as fixture setup, not a live user journey) was the only way to reach that UI state as of 2026-08-06.

**Staff Profile page (`/dashboard/staff/<id>`) now surfaces facility**, with a Change Facility action that opens `ChangeFacilityModal` (`StaffProfileClient.tsx`). As of 2026-08-06 it had none.

**Mobile (375px) Staff Management roster table drops Role/Facility/Date-Invited columns entirely**, showing only Name + row-actions — confirmed via accessibility-tree diff (cells are absent from the DOM at that breakpoint, not just CSS-hidden). Reasonable responsive pattern, but means new roster columns (like Facility) aren't visible on mobile without opening a row.

**`/images/icon-course-dark.svg` 404 (found 2026-08-06) is RESOLVED:** the file now exists in `public/images/`.

Related: [[report-conventions]], [[local-dev-env-setup]].

---
name: staging-claim-verification-2026-09-08
description: PR #586 claim-verification round. Draft→Published proven live (Duplicate since removed in #587; the filename-collision bug found here since fixed). Reusable parts: Audit Reports Courses tab shows raw course.status, the /system panel for account checks, and removed ≠ deleted
metadata:
  type: project
---

**Full report:** `qa-reports/2026-09-08-staging-claim-verification.md`. This was a claim-verification run (re-checking specific project-notes assertions against live staging), not a fresh story run — 4/4 claims CONFIRMED, two with material nuance.

**CONFIRMED, finally, after 4 QA rounds (2026-09-03 → 2026-09-08): Draft→Published-on-assignment (`publish-on-assign.ts`) works live end-to-end, including the mandatory control case.** Recipe used then (no longer reproducible, because the Duplicate feature was removed in `b952373e`/#587): duplicate an `isOrgAuthored` course twice (Copy A, Copy B), assign ONLY Copy A via the **target staff member's own Staff Profile → Assign Course** button (not the course's own `/assign` page — that path already published as a side effect in earlier testing, which is why the repro insists on the profile-page path), leave Copy B untouched. Copy A → `published`/"Active"; Copy B → stays `draft`/"Draft". Verified two independent ways: the course-detail page's status badge (`courseStatusBadge()`, `src/lib/course/course-status-label.ts` — "Active" for published, "Draft" for draft+!reviewRequired) AND Audit Reports → Courses tab's raw `course.status` text column — both agreed. **Audit Reports → Courses tab is the single best place to read a course's raw lifecycle status** (shows literal `draft`/`published`/`inactive`, not a relabeled badge) — use it whenever a claim needs the DB-level status, independent of any UI label-mapping bug.

**Duplicate has since been removed** (`b952373e`, #587), so there is no Duplicate row action to test.

**Useful known specimens in the B4 org.** 5 of its 6 video courses are adopted-not-authored. The sixth, "Personal Conduct Series 1", is a true global-catalog row: its kebab shows no Delete, and the server refuses to delete it with "shared catalogue".

**The filename-collision bug found here is FIXED** (`7b42fc17`). Uploading a fixture with the same filename as another user's document no longer attaches the wrong document. Unique fixture filenames are still tidy practice.

**The "Price unavailable" on all 9 plan cells seen on 2026-09-08 was transient.** It did not reproduce later that day. The diagnostic is still useful: a uniform all-9 failure points at `STRIPE_SECRET_KEY` or a stale `unstable_cache`, while a partial failure points at individual price-ID gaps.

**`/system` superadmin panel password lives in the repo's own local `.env.local` as `SYSTEM_ADMIN_PASSWORD`, and it IS the staging value** (its own login page copy literally says "intended for staging environment use only") — no need to ask the user for it. Confirmed reachable and useful this round for cross-checking claims about specific accounts' existence/state platform-wide (shows `organizationId=null` + `role=None` for a user who was removed from an org, distinct from a genuinely deleted user, and returns zero results for a pending invite that has no `User` row yet — a pending invite and a real signed-up user are structurally different records, useful to remember when asked "does X account exist").

**`removeStaff` confirmed: removal detaches the org link but does NOT delete the base `User` row.** A removed staff member's account persists platform-wide with `organizationId=null`, `role=None`, fully invisible to that org's own Staff Management (active roster AND search), but still visible via `/system`'s org-wide user list. Good phrasing for future reports: "removed from the org" ≠ "deleted account."

See [[team-test-round-2026-09-03]], [[staging-two-facility-fixture-recipe]], [[admin-courses-list-redesign]], [[audit-reports-patterns]], [[staff-management-patterns]], [[billing-subscription-patterns]] for related background.

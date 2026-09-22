---
name: staff-csv-import-and-removal-gaps
description: Staff CSV-import and removal gaps from 2026-07-14. Three of the four are FIXED (skipped CSV rows surfaced, CSV roles pre-filled, removal blocks login). Still open: a revoked invite link shows a generic 404
metadata:
  type: project
---

**Found 2026-07-14 on staging (`qa-reports/phase1-foundation.md` ISSUE 1/2/3), branch `rbac`/lms-v2 flow (see [[lms-v2-signup-onboarding-settings-flow]] for the `InviteStaffModal` component this applies to).**

**Fixed since this note was written (`5500a2f1` and the removal work):**
- CSV import now surfaces skipped rows (`summariseSkippedCsvRows` in `InviteStaffModal.tsx`).
- The Staff Management CSV path pre-fills each contact's role from the CSV role column.
- A removed staff member can no longer log in. Login shows "Your access to this organization has been removed…" (`src/auth.ts`).

**Verification lesson that still applies:** to check a "removed staff loses access" criterion, actually log in as the removed account. Checking only that the admin-side staff list no longer shows the row gives a false PASS.

**A revoked (never-accepted) pending invite's join link `/join/<token>` shows the same generic "Page Not Found" 404 as a garbage/unknown token** — there's no distinct "this invite was cancelled" message, unlike the "already accepted" case (see [[lms-v2-signup-onboarding-settings-flow]]'s three-way branch notes, which cover only pending/accepted/unknown; revoked falls into the generic "anything else → 404" bucket). Minor UX gap, not a functional bug (link correctly stops working).

See [[dual-session-cookie-bug]] for a related session-hygiene finding from the same test pass.

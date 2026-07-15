---
name: staff-csv-import-and-removal-gaps
description: CSV-invite silent-row-skip + role-column-ignored inconsistency, and Remove-Staff not fully revoking dashboard access -- found 2026-07-14 on staging RBAC/lms-v2 flow
metadata:
  type: project
---

**Found 2026-07-14 on staging (`qa-reports/phase1-foundation.md` ISSUE 1/2/3), branch `rbac`/lms-v2 flow (see [[lms-v2-signup-onboarding-settings-flow]] for the `InviteStaffModal` component this applies to).**

**CSV import silently drops malformed rows with zero error UI, in BOTH CSV import paths** (onboarding step5 "Import with .csv file instead" AND Staff Management "Add Workers" → "Click to upload .csv file instead"). Tested with a CSV mixing valid rows + a missing-email row (`,nurse`) + a malformed-email row (`not-an-email,nurse`): only the valid rows import, with just a bare count shown ("N valid emails found" / "N contacts imported") — no toast, banner, or console message ever names or counts the skipped rows. If a QA pass needs to verify "malformed rows flagged with a clear error," this currently FAILS — don't assume it passes just because the valid rows import correctly.

**The two CSV import paths are NOT behaviorally identical despite sharing the same CSV template/format** (`email,role` header, e.g. `nurse`, `therapist_clinician`). The **onboarding-wizard** CSV import (step4/step5) correctly pre-fills the role dropdown per contact from the CSV's role column. The **Staff Management "Add Workers"** CSV import does NOT — every imported contact (even fully valid ones) lands on the "Assign roles" step with "Select role" still showing as a placeholder, requiring the admin to manually re-select every role by hand (or use "Set every role to" to bulk-apply one role to all). If testing role-fidelity from a CSV import, only trust the onboarding-wizard path; the Staff Management path needs a manual role pass regardless of what the CSV said.

**"Remove Staff" does not fully revoke dashboard access — it's a soft/partial removal.** Confirmed via `/api/auth/session`: after "Remove Staff" is confirmed (including the friendly confirmation copy "They will no longer be able to access assigned courses or your organization's dashboard"), the removed user's session shows `organizationId: null` but the stale `role` (e.g. `"hr"`) is still present, and the user **can still log in and reach a full `/dashboard` shell** (sidebar renders per their old role, e.g. Staff Management/Audit Reports links for a former HR). No real data leak occurs — every list under that empty-org session correctly renders "0 of 0" — but the login/dashboard-shell access itself directly contradicts the UI's own promised behavior. If verifying a "deleted staff loses access" acceptance criterion, actually log in as the removed account and check `/dashboard` renders — don't just check the admin-side staff list no longer shows the row, that part alone will give a false PASS.

**A revoked (never-accepted) pending invite's join link `/join/<token>` shows the same generic "Page Not Found" 404 as a garbage/unknown token** — there's no distinct "this invite was cancelled" message, unlike the already-fixed "already accepted" case (see [[rbac-join-token-critical-bug]] / [[lms-v2-signup-onboarding-settings-flow]]'s three-way branch notes, which only covers pending/accepted/unknown — revoked falls into the generic "anything else → 404" bucket too). Minor UX gap, not a functional bug (link correctly stops working).

See [[dual-session-cookie-bug]] for a related session-hygiene finding from the same test pass.

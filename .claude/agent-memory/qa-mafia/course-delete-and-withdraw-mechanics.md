---
name: course-delete-and-withdraw-mechanics
description: deleteCourse fails on courses with active enrollments (FK RESTRICT, redacted #441) but the app's own "Withdraw assignment" unblocks it — and that Withdraw action only exists for reading/org-authored courses, not video/adopted ones
metadata:
  type: reference
---

**Deleting an org-authored course with an active enrollment fails on the first attempt with a generic "Failed to delete course." toast (server-side: `[course] Delete failed`, redacted `Minified React error #441`, consistent with `[[server-action-errors-are-redacted]]`) — this is `enrollments.course_id → courses` FK RESTRICT (`[[db-cleanup-fk-order]]`) surfacing as an unhandled throw, not a friendly refusal.** The correct in-UI fix, confirmed live 2026-09-08: open the course's own detail page → **Enrolled Staff** table → per-row **Row actions → "Withdraw assignment"** → confirm the dialog (it names the exact course and warns completion history is deleted with it, non-reversible) → THEN retry Delete, which now succeeds cleanly. This is a real, intended two-step flow, not a workaround — always withdraw enrollments before deleting a course that has any.

**"Withdraw assignment" only exists for reading/org-authored courses — video/adopted-catalog courses have no in-UI way to unenroll a single staff member at all**, confirmed by exhausting every plausible path on a real adopted video course (staging, "Infection Control in the Human Service Environment", `isOrgAuthored=false`):
- Course's own Enrolled Staff table Row-actions → only a disabled "Assign Retake", no Withdraw.
- Staff Profile → Trainings table Row-actions → same, only disabled "Assign Retake".
- Course-level "Assign to staff" dialog → add-only, defaults to "Assign to 0 staff", no visibility into or control over existing assignees.
- Staff-Profile-level "Assign Courses" dialog → every course checkbox renders `aria-checked="false"` regardless of actual current enrollment state — it's a fresh picker for NEW assignments, not a manage/toggle view.

If a future task needs to revert a single staff member's enrollment in a video/adopted course, there is currently no UI path — either accept it as unrevertable-without-DB-access, or flag it as a product gap worth fixing (parity with the reading-course Withdraw action). This is a different, more specific version of the "adopted courses never get Duplicate/Delete" gating already documented in `[[staging-claim-verification-2026-09-08]]` — the same `isOrgAuthored` split extends to per-enrollment withdrawal too, not just to course-level duplicate/delete.

**`/system` superadmin panel's own user-delete flow is exemplary UX to imitate when auditing what a delete will touch**: before allowing the destructive click, it renders an explicit "Records to be deleted" table (User Account / Notifications / Invites / etc. counts) and requires typing the exact email to confirm — good precedent, and a reliable way to sanity-check a deletion's blast radius before committing to it in this app specifically.

See [[db-cleanup-fk-order]], [[server-action-errors-are-redacted]], [[staging-claim-verification-2026-09-08]], [[admin-courses-list-redesign]] for related background.

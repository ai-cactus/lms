---
name: course-delete-and-withdraw-mechanics
description: deleteCourse now ARCHIVES (archivedAt, nothing removed; global-catalogue courses refuse); Withdraw assignment is gated on assignment.delete and works for adopted video courses too (PR #663); /system delete-preview UX
metadata:
  type: reference
---

**Delete archives; it no longer hard-deletes.** `deleteCourse` sets `archivedAt`. Course rows, enrolments and certificates are kept, so enrolments no longer block it and you do not need to withdraw first. Refusals are *returned* rather than thrown, so the user sees a real message instead of the redacted React #441. Global-catalogue courses refuse with "This course comes from the shared catalogue and cannot be deleted here." An archived course is hidden on the read side only; see the user memory `archive-semantics-are-read-side-only`.

**"Withdraw assignment"** is on the course detail page: Enrolled Staff table → Row actions. It is gated on `assignment.delete` plus org membership (`training/courses/[id]/page.tsx`: `canWithdrawAssignments = can(roleKey,'assignment.delete') && !!organizationId`). It works on adopted video courses as well as org-authored ones; that was fixed in PR #663 and confirmed live in [[backlog-clearing-batch-2026-09-21]]. The dialog warns that completion history is deleted with the enrolment and that this cannot be undone.

**`/system` superadmin panel's own user-delete flow is exemplary UX to imitate when auditing what a delete will touch**: before allowing the destructive click, it renders an explicit "Records to be deleted" table (User Account / Notifications / Invites / etc. counts) and requires typing the exact email to confirm — good precedent, and a reliable way to sanity-check a deletion's blast radius before committing to it in this app specifically.

See [[db-cleanup-fk-order]], [[backlog-clearing-batch-2026-09-21]], [[admin-courses-list-redesign]] for related background.

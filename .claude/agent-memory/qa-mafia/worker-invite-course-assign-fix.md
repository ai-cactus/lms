---
name: worker-invite-course-assign-fix
description: PR #403 unified /join course-assign invites, live-verified 2026-07-24 (7/7 ACs). removeStaff's clean-slate behaviour has since been REVERSED: it now retains all enrollments (Q23, 243375f4). Covers the disclosed-DB-fixture trick for the pending-invite-expiry branch
metadata:
  type: project
---

**Live-verified PASS (2026-07-24, local dev, HEAD `f249a0b` on `feat/cleanup`, PR #403/`55406a0` already merged).** Full report: `qa-reports/worker-invite-course-assign-remove-reinvite.md`. Confirms, end-to-end through the real browser + DB:
- Assigning a course to an unknown/org-less email creates a `pending` `Invite` + `InviteCourseAssignment` (no premature `User` row), shown under the Assign page's "Pending invites for this course" section.
- `EmailMessage.kind='course_invite'` fires (never a temp-password email) — confirmed via the `email_messages` table even when real SMTP delivery itself failed (see [[local-dev-smtp-auth-skip-bug]]).
- `/join/{token}` accept creates the real account + materialises the enrollment with `due_at` correctly computed (system-default 30-day window when the assignment's own `dueAt`/`dueWindowDays` are left blank).
- `removeStaff()` (current behaviour; the PR-#403 clean slate was reversed by founder Q23 in `243375f4`) retains ALL enrollments, including in-flight ones, plus their certificates. In one transaction it deactivates the membership, bumps `sessionVersion`, and expires any `pending` invite for that email/org.
- Re-inviting the same email post-removal succeeds cleanly (fresh token, no "already a member" error) and re-links the **same** `users.id` — confirmed via DB — and all enrollments, including in-flight ones, resurface on re-invite. **Negative control confirmed the guard still fires correctly for a genuinely-still-active staffer** (`worker@test.com`, never removed) — re-inviting them surfaces "1 already a member or invited", proving the fix only relaxes the check for org-less/removed accounts, not a blanket bypass.

**Non-obvious test-design note:** the "expire pending invite on remove" branch (`removeStaff()`'s third transaction step) is **not reachable through a single ordinary live UI pass** for the same (email, org) pair — both `createInvites()` and `createEnrollmentForUser()` reuse/refresh one pending invite per email+org rather than ever creating a second row, and an accepted invite immediately flips to `status='accepted'`. By the time someone is a real, removable staff member, their own invite is already `accepted`. To exercise this branch with genuine confidence I seeded one synthetic `pending` invite row directly via SQL (disclosed in the report) — mirroring how the project's own `staff.test.ts` unit-tests the same branch — rather than trying to force it through the UI. If retesting this story later, don't waste time hunting for an organic UI path to a stray pending-invite-while-active state; go straight to a disclosed DB fixture insert.

See [[local-dev-smtp-auth-skip-bug]] for the real (separate, pre-existing) transport gap discovered while validating AC2. For the current /join three-way branch, see [[lms-v2-signup-onboarding-settings-flow]].

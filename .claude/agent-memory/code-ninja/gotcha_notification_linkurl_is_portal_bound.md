---
name: gotcha-notification-linkurl-is-portal-bound
description: A notification linkUrl is portal-bound — /worker/** needs a worker cookie, /dashboard/** an admin one; /learn/[id] is the only route serving both, and 4 admin routes each lock out a different manager role
metadata:
  type: project
---

A `linkUrl` is not just a path: it picks a **session realm**. `/worker/**` is
served only against a worker-instance cookie and `/dashboard/**` only against an
admin one (`ROUTE_CONFIG` in `src/proxy.ts`), so a link written for the wrong
realm answers `/login` to a signed-in recipient. Fixed on
`fix/notification-link-destinations` (2026-09-24).

**Why it keeps happening:** `createNotification` addresses ONE membership, and
for the training notices that membership is the **assignee**. Managers are
assigned courses like anyone else, so "the recipient is a worker" is an
assumption, never a fact. Four writers had hardcoded `/worker/trainings`:
`enrollment/notify.ts`, `enrollment/create.ts`, the ladder stage + WORKER_RETAKE
nudge in `reminders/dispatch.ts`, and the renewal notice in `reminders/sweep.ts`.

**How to apply:** when writing a notification for a *person*, resolve the
destination from that membership's role (`trainingNoticeLink` in
`src/lib/notifications/portal-link.ts`), and add `role: true` to whatever query
already loads the membership. When writing for a *role audience* (escalation
recipients, `notifyOrganizationAdmins`, the emit engine's routing table) the
realm is admin by construction — the risk there is PERMISSION, not portal.

Two facts worth keeping:

- **`/learn/[id]` is the only route that serves both realms.** It is outside the
  proxy matcher and `getLearnPayload` resolves the worker session first, then
  falls back to the admin one. Caveat: opened from the admin portal by a role
  holding `course.read` it renders the REVIEW/editor view, not the learner view
  (`isAdmin = mayOpenWithoutEnrollment && !inLearnerPortal` — the deliberate D-16
  shape). A manager actually *takes* a course via the sidebar Manage/Learn
  switcher (`enterLearnMode`).
- **No `/dashboard` route below the home page is reachable by all six admin
  roles.** Training + course detail need `course.read` (Finance has none), Status
  Tracker needs `assignment.read` (not Finance), Staff needs `user.read` (not
  Clinical Director, not Finance). `/dashboard` itself is the only universal
  admin landing — which is why a multi-course notice falls back to it.

See [[rbac_role_model]], [[auth_instance_vs_role]],
[[gotcha_admin_auth_instance_is_the_tier_check]].

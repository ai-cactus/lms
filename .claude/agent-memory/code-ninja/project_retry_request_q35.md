---
name: project-retry-request-q35
description: Q-35 locked-learner retry requests — pending is DERIVED (no status), admin notices about one learner must use facility-audience.ts, not notifyOrganizationAdmins
metadata:
  type: project
---

Q-35 (ruled 2026-10-07): a `locked` learner may ask for a retake. No decline; re-ask after 72h.

- **No status is written.** `requestCourseRetry` stamps `Enrollment.retryRequestedAt` only.
  Pending = `locked` + `retryRequestedAt` + no `retakeOf` successor; granted = a successor
  exists. `failed` / `retry_requested` enum values are still never written (tracked as an
  open issue) — don't start writing them.
- **`notifyOrganizationAdmins` is NOT facility-narrowed** (only Q-25 link-permission
  narrowed). A notice about ONE learner should go through
  `src/lib/notifications/facility-audience.ts` (`notifyLearnerAdmins`): org-wide admin
  tier + admins rostered (active OUF) where the learner is rostered now, minus opt-outs,
  each channel behind the org switch. Training email defaults OFF, so no email in e2e.
- **Deep link** `/dashboard/staff/{ou}?retake={enrollmentId}` auto-opens AssignRetakeModal
  once via a `useState` initializer, only for a locked, not-yet-retaken row on that profile.
- `assignRetake` (SEC-19) now reads the enrolment org-scoped, facility-partitions the learner,
  and refuses ANY successor. Its unit tests need `facility.findMany` +
  `organizationUser.findMany` mocks and an `organizationUserId` on supervisor sessions.

Related: [[gotcha_notification_linkurl_is_portal_bound]], [[gotcha_server_action_refusals_must_return]].

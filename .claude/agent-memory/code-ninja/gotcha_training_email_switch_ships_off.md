---
name: gotcha_training_email_switch_ships_off
description: Training (and workforce) category email ships OFF, so gating an admin email on isNotificationChannelEnabled silences it for every org without a stored row
metadata:
  type: project
---

`NOTIFICATION_CATEGORY_DEFAULTS` in `src/lib/notifications/catalog.ts` has `training` and
`workforce` at `emailEnabled: false`. Since Q-34 (ruled 2026-10-07, "honour the switch"),
`notifyOrganizationAdminsWithEmail` checks the email switch, so the quiz-locked admin email
(QUIZ_RETRY_LIMIT_REACHED, category training) is NOT sent for an org that never toggled it.

**Why:** the user ruled the email must follow the org switch like emit.ts's instant path does;
the default-off consequence is intended, not a regression.

**How to apply:** route-level tests that expect an admin email must stub
`notificationCategoryPreference.findUnique` to `{ emailEnabled: true, ... }` (and reset it
afterwards — `vi.clearAllMocks` keeps implementations). Don't "fix" a missing quiz-locked
email on a fresh org by bypassing the switch. Related: [[project_email_delivery_tracking]].

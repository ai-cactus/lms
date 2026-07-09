---
name: email-delivery-tracking
description: EmailMessage delivery tracking has TWO recording paths that must not overlap — double-record footgun
metadata:
  type: project
---

Email delivery is tracked via the `EmailMessage` model (prisma/email.prisma) through TWO distinct paths — keep them disjoint or you double-record.

- **Reminder-ladder sends** (Track A/B): tracked by `src/lib/reminders/dispatch.ts` (`deliverReminderEmail`), which creates the `EmailMessage` row (kind `reminder_stage`/`reminder_nudge`, `reminderLogId` set for ladder, null for nudges) and transitions it to sent/failed off the real transport result threaded up through `email-sender.ts` (`ReminderEmailSender` returns `EmailDeliveryResult`, not void).
- **All other sends** (invite, verification, reports, etc.): tracked at the transport layer by `sendMailTracked(options, kind)` in `src/lib/email.ts`.

**Why:** The 4 reminder senders in `email.ts` — `sendDeadlineReminderEmail`, `sendDeadlineOverdueWorkerEmail`, `sendEscalationEmail`, `sendRetakeReminderEmail` — deliberately call `transporter.sendMail` DIRECTLY (not `sendMailTracked`), because dispatch already records their EmailMessage. Routing them through `sendMailTracked` would create a second row per send and the sweep retry pre-pass would double-fire.

**How to apply:** When adding/editing an email sender: non-reminder → route through `sendMailTracked` with a `kind`. Reminder-path sender used by `email-sender.ts` → leave on raw `transporter.sendMail`. The sweep retry pre-pass (`runRetryPrePass` in `sweep.ts`) only reconstructs rows WITH a `reminderLogId` (via the linked ReminderLog + enrollment); nudge/generic failures aren't reconstructable and are intentionally not retried.

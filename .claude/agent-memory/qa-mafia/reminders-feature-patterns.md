---
name: reminders-feature-patterns
description: Key UI patterns, DB schema, and known bugs for the Reminders & Escalations feature tested 2026-06-30
metadata:
  type: project
---

## Feature: Reminders & Escalations (feat/reminders branch, tested 2026-06-30)

**Assignment flow:** Admin → Courses → View course → "Assign" button → `/dashboard/training/courses/{courseId}/assign`

The assign page contains:
- "Assign To" text field + "Invite" button (type email, click Invite to add chip; does NOT show autocomplete for existing users)
- "Training Schedule" date picker (optional, access date)
- "Due Date" date picker (button: "Select due date", opens Calendar dialog, past dates disabled)
- "Renewal Settings" combobox
- "Deadline Reminders" section: `Send deadline reminders` checkbox (pre-checked by default)
- "Advanced reminder schedule" expandable button → 5 rows: Friendly reminder (−14d), Urgent reminder (−3d), Day of deadline (0d), Grace period / soft escalation (+3d), Overdue / hard escalation (+7d); each row has a spinbutton for offset and an Enabled checkbox

**Success:** Modal dialog "Course Assigned Successfully" with "Workers have been assigned and are now enrolled in this course."

**In-app notification title:** "New Required Training Assigned" (FIXED 2026-06-30 — was "New Course Assigned") — type: COURSE_ASSIGNED in DB.

**RESOLVED bug (was MEDIUM, ISSUE-S1-01, resolved 2026-06-30):** Due date now renders correctly in worker-facing UI. Worker dashboard "My Courses" table Deadline column shows the date (e.g. "Jul 14, 2026"); trainings card shows "Due Jul 14, 2026". Previously showed "No deadline". Fix verified in re-validation.

**DB schema:**
- `enrollments`: `due_at`, `started_at`, `completed_at`, `status`, `user_id`, `course_id`, `assignment_id`
- `course_assignments`: `due_at`, `reminders_enabled`, `schedule_at`, `renewal_cycle`, `course_id`, `org_id`, `assigned_by_admin_id`
- `assignment_reminder_stages`: `assignment_id`, `stage` (FRIENDLY_REMINDER | URGENT_REMINDER | DAY_OF_DEADLINE | GRACE_SOFT_ESCALATION | HARD_ESCALATION), `offset_days`, `enabled`, `channels`
- `notifications`: `type`, `title`, `message`, `is_read`, `user_id`, `link_url`, `metadata`

**Manager assignment:** On `/dashboard/staff/{userId}` there is a `combobox "Assign manager"`. Dropdown lists only admin-role users in the org; saves immediately with "Manager updated successfully" inline text. No Save button needed — selecting triggers save automatically.

**Compliance page:** `/dashboard/compliance` reachable via sidebar PERFORMANCE nav. Shows table: Worker, Course, Due date, Days overdue, Status, Manager. Stats bar: "Overdue training: N" + "Hard escalations (7+ days): N". Hard-escalation banner ("Training overdue — action needed") persists across ALL admin pages (not just dashboard homepage).

**Accessibility issue (low, open):** Calendar DialogContent missing DialogTitle — Radix console errors on assignment form.

**Local DB access:** `postgresql://postgres:0951@localhost:5433/lms` (pg client in node_modules/pg). Use `require('pg')` inline Node.js scripts.

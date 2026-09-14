---
name: targetroles-backfill-is-provable
description: course_assignments.target_roles was backfilled in the SAME migration that added it, so no legacy row has only the singular target_role
metadata:
  type: project
---

`prisma/migrations/20260814120000_add_course_module_fields_and_assignment_target_roles/migration.sql`
adds `course_assignments.target_roles` AND backfills it in one file:

```sql
UPDATE "course_assignments"
SET "target_roles" = ARRAY["target_role"]::"UserRole"[]
WHERE "target_role" IS NOT NULL AND "target_roles" = '{}';
```

Since the column cannot exist without the backfill having run, and every write
since goes through `roleTargetColumns` (`src/lib/enrollment/assignment.ts`) which
writes both columns together, "every row with a non-null `target_role` has a
non-empty `target_roles`" is provable, not assumed.

**Why:** it keeps coming up whenever a reader still filters on the deprecated
singular column — the question is always "can I just swap the condition?"

**How to apply:** reads may move to `targetRoles` alone. The one place that
deliberately does NOT is the nightly sweep's role-target reconcile pre-pass,
which unions both conditions: it is a backstop, and a backstop that silently
stops matching rows is the one failure nothing downstream would report. Don't
"simplify" that OR away. Related: [[gotcha_role_assign_count_vs_reach]],
[[sweep-test-mock-queue-coupling]].

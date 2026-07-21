---
name: db-cleanup-fk-order
description: FK delete-rule map + working pattern for gated QA-data cleanup via direct Postgres access on this app's schema
metadata:
  type: reference
---

**Access pattern that works reliably:** `docker exec lms-dev-db psql -U postgres -d lms -c "..."` for one-off queries, or `docker exec -i lms-dev-db psql -U postgres -d lms < script.sql` (stdin heredoc) for a multi-statement transaction — avoids quoting pain vs. `-c` with embedded `BEGIN;...COMMIT;`. Confirmed working 2026-07-09 for a real two-batch cleanup.

**Pre-flight before any delete:** query `information_schema.table_constraints` / `key_column_usage` / `constraint_column_usage` / `referential_constraints` joined together to get the full FK map **including `delete_rule`** for every table referencing the parents you're about to delete (`users`, `organizations`, `facilities`, `courses`, `enrollments`, etc.) — don't guess from Prisma schema reading alone, the live DB's actual `ON DELETE` behavior is what matters. Template:
```sql
SELECT tc.table_name child, kcu.column_name fk_col, ccu.table_name parent, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name AND tc.table_schema=ccu.table_schema
JOIN information_schema.referential_constraints rc ON tc.constraint_name=rc.constraint_name AND tc.table_schema=rc.constraint_schema
WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name IN ('users','organizations','facilities','courses','enrollments');
```

**Known RESTRICT edges on this schema (as of 2026-07-09) that dictate deletion order — CASCADE elsewhere is more forgiving but don't rely on memory, re-check live:**
- `users.organization_id → organizations` = RESTRICT, `users.facility_id → facilities` = RESTRICT → **always delete the user row before its organization/facility**, even though `facilities → organizations` and `invites → organizations` are themselves CASCADE.
- `courses.created_by → users` = RESTRICT → **delete any course before deleting the user who created it** (check `courses.created_by`/`approved_by_user_id` for every user you're removing, not just the obvious "owner" role).
- `enrollments.course_id → courses` = RESTRICT (even though `enrollments.user_id → users` is CASCADE) → **delete enrollments before their course**, regardless of whether you're also deleting the enrolled user.
- `certificates.course_id → courses` = RESTRICT too — check for certificates before assuming a course has no blockers.
- Practical order that satisfied every constraint in a real run: `invites → enrollments → courses → profiles → users → facilities → organizations`. `profiles.id → users.id` is CASCADE so deleting it explicitly is optional but harmless/explicit.
- `audit_logs` and `email_messages` have **no FK constraints at all** into `users`/`organizations` (`actor_id`, `to_email` are plain text columns) — they never block a delete, and per project convention (confirmed 2026-07-09) are **intentionally left in place** even when their referenced account is deleted, since this is a compliance product and audit-trail rows aren't pruned without an explicit ask.

**Zero-row-count verification is itself useful pre-flight evidence** — running a `UNION ALL SELECT count(*) FROM child WHERE fk=<id>` sweep across every candidate child table for each row you're about to delete (documents, certificates, notifications, mfa_factors, mfa_recovery_codes, course_modules, lessons, quizzes, quiz_attempts, course_versions, course_artifacts, org_course_offerings, course_assignments, reminder_logs, reminder_nudges, facility_documents) before running any `DELETE` gives high confidence the batch is truly self-contained and that "children first" won't discover a surprise mid-transaction. Do this for every table in the FK map, not just the ones the requester mentioned — a requester's list can be incomplete.

**Verification-token cleanup:** `verification_tokens` has no FK constraints (keyed by `identifier`+`token` only) — just `DELETE ... WHERE identifier=<email>`. In practice these rows are usually already gone by cleanup time (the app deletes the token at verification), so an empty result is expected and fine, not a sign you missed something.

See [[local-dev-env-access]] for DB connection basics and [[lms-v2-signup-onboarding-settings-flow]] for the onboarding-created row shapes (users/organizations/facilities/invites) this pattern is most often cleaning up.

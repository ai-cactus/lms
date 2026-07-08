-- Settings page fields.
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY the two new
-- columns — the diff engine otherwise tries to drop the raw-SQL-managed
-- `manual_chunks` pgvector column and the DB-level defaults on `facilities`.

-- users.last_login_at — set on each successful sign-in (credentials + OAuth),
-- surfaced as "Last active" on the Settings → Users & Permissions tab.
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);

-- facilities.type — editable facility category (Behavioral health, etc.),
-- managed on the Settings → Facility tab.
ALTER TABLE "facilities" ADD COLUMN "type" TEXT;

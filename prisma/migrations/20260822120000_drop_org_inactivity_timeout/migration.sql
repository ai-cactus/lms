-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the dead `organizations.inactivity_timeout_minutes` column.
--
-- The idle-timeout window is governed entirely by the INACTIVITY_TIMEOUT_MINUTES
-- environment variable — the server JWT `maxAge` and the value now stamped onto
-- the session at sign-in (token.inactivityTimeoutMinutes) — which the client
-- InactivityTimer reads. This column had no reader or writer anywhere in the
-- app and its per-org value was never surfaced or editable.
--
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY this drop — the
-- diff engine otherwise also tries to drop the raw-SQL-managed `manual_chunks`
-- HNSW index and the DB-level defaults on `facilities`, which are intentional.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "inactivity_timeout_minutes";

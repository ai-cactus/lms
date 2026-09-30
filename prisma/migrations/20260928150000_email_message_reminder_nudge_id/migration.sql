-- ─────────────────────────────────────────────────────────────────────────────
-- email_messages.reminder_nudge_id — the ReminderNudge a `reminder_nudge` send
-- was claimed under (BUG-22). The nudge counterpart of reminder_log_id: the
-- sweep's retry pre-pass rebuilds a failed send from the row it points at, and
-- a nudge send used to carry no pointer at all, so it was never retried.
--
-- Nullable with no backfill: rows written before this column have nothing to
-- point at and stay unretryable, exactly as before. Unconstrained (no FK), like
-- reminder_log_id, so the delivery trail survives deletion of the nudge.
--
-- HAND-AUTHORED. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the
-- pgvector HNSW index is raw-SQL-managed and `migrate dev` re-emits a DROP for
-- it every time. No index: the retry pass reads it only off rows it already
-- selected by status.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "reminder_nudge_id" TEXT;

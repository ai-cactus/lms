-- ─────────────────────────────────────────────────────────────────────────────
-- cycle_summary_items.recipient_role — the audience a reminder line was written
-- for (`worker` | `escalation`), added to the row's unique key (BUG-21).
--
-- A self-escalating admin's own overdue course is one source row carried TWICE
-- by one summary email: once under "Your training", once under "Team &
-- compliance". The old key (email_message_id, item_type, item_id) collapsed the
-- two copies under `createMany({ skipDuplicates: true })`, so a retried summary
-- could only rebuild one and silently lost the team section.
--
-- Existing rows take '' (unknown): the retry pass keeps inferring their role
-- from the recipient's address, exactly as before. Widening a unique key cannot
-- create a violation, so the swap is safe on populated tables.
--
-- Idempotent: every statement is guarded, so a re-run is a no-op.
--
-- HAND-AUTHORED. No `DROP INDEX "manual_chunks_embedding_hnsw_idx";` — the
-- pgvector HNSW index is raw-SQL-managed and `migrate dev` re-emits a DROP for
-- it every time.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cycle_summary_items" ADD COLUMN IF NOT EXISTS "recipient_role" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "cycle_summary_items_email_message_id_item_type_item_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "cycle_summary_items_email_message_id_item_type_item_id_reci_key" ON "cycle_summary_items"("email_message_id", "item_type", "item_id", "recipient_role");

-- F-001: append-only audit trail (audit_logs).
-- Written exclusively via the shared audit() helper in src/lib/audit.ts.
-- The application never UPDATEs or DELETEs these rows (immutable by convention).
-- actor_id / organization_id are plain string references (no FK) so the audit
-- history survives deletion of the referenced user or organization.

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "organization_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: org-scoped chronological reads (compliance exports per organization)
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex: per-actor chronological reads (who did what, over time)
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex: per-action chronological reads (e.g. all phi.document.access events)
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

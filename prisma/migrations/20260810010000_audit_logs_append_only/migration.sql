-- Enforce append-only on audit_logs and phi_decisions (F-080).
--
-- Both tables were "append-only by convention": nothing stopped an UPDATE or
-- DELETE, so the audit trail HIPAA §164.312(b) and SOC 2 CC7 treat as a control
-- could be rewritten by any code path that chose to.
--
-- ── Why a TRIGGER and not just REVOKE ───────────────────────────────────────
-- The obvious fix is `REVOKE UPDATE, DELETE ... FROM <app role>`. That does
-- nothing here: the application connects as `postgres`, a SUPERUSER, and
-- superusers bypass all privilege checks. A REVOKE-only migration would look
-- like enforcement while changing nothing.
--
-- Triggers are not privilege checks — they run regardless of the invoking role,
-- superuser included. So the trigger is what actually enforces this today. The
-- REVOKE below is kept as defence-in-depth: it becomes meaningful the moment the
-- app stops running as superuser, which is tracked separately (F-093) and is
-- also a prerequisite for the F-007 RLS work, since RLS is likewise bypassed by
-- superusers and table owners.
--
-- ── Honest limits ───────────────────────────────────────────────────────────
-- This stops accidents and casual tampering from application code. It is NOT
-- tamper-proofing against someone with direct database access, who can drop the
-- trigger. Genuine tamper-evidence requires shipping these rows to an
-- append-only sink outside this database — that is what the Cloud Logging export
-- is for.
--
-- ── Retention escape hatch ──────────────────────────────────────────────────
-- Audit rows are retained ≥6 years and runRetentionPurge explicitly excludes
-- them, so nothing in the app needs DELETE. But a blanket permanent block would
-- leave no lawful way to dispose of rows once retention genuinely expires. A
-- purge must therefore opt in explicitly, per-transaction:
--
--     BEGIN;
--     SET LOCAL app.allow_audit_purge = 'on';
--     DELETE FROM audit_logs WHERE created_at < now() - interval '6 years';
--     COMMIT;
--
-- Deliberate, greppable, and impossible to trip over by accident.

CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER AS $$
BEGIN
  -- UPDATE is never legitimate on an immutable ledger.
  IF (TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION
      '% is append-only: UPDATE is not permitted (row id %)', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- DELETE only under an explicit, transaction-scoped opt-in.
  IF (TG_OP = 'DELETE') THEN
    IF current_setting('app.allow_audit_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        '% is append-only: DELETE requires SET LOCAL app.allow_audit_purge = ''on'' (row id %)',
        TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- BEFORE, so the statement is rejected rather than performed and then undone.
DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs";
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

DROP TRIGGER IF EXISTS phi_decisions_append_only ON "phi_decisions";
CREATE TRIGGER phi_decisions_append_only
  BEFORE UPDATE OR DELETE ON "phi_decisions"
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- Defence-in-depth. Inert while the app is superuser; effective as soon as it
-- is not. Guarded so the migration does not fail on an environment where the
-- role does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lms_app') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM lms_app;
    REVOKE UPDATE, DELETE ON "phi_decisions" FROM lms_app;
  END IF;
END $$;

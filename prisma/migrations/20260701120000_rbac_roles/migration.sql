-- RBAC rollout: replace the two-value UserRole enum (admin | worker) with the
-- category-aware role set — five manager roles plus eight job-specific worker
-- roles (all worker roles share the identical worker permission ceiling; they
-- differ only by category + display name). Existing data is migrated in place:
--   admin  -> supervisor          (facility admin; earliest per-org is later
--                                   promoted to `owner` by scripts/backfill-roles.js)
--   worker -> front_desk_admin    (mirrors DEFAULT_SELF_SERVE_WORKER_ROLE in
--                                   src/lib/rbac/role-utils.ts — kept in sync
--                                   manually since SQL cannot import TS)
--   (any other legacy value) -> front_desk_admin
-- Neither column carries a DEFAULT: every user/invite creation must supply an
-- explicit role (D4).

CREATE TYPE "UserRole_new" AS ENUM (
  'owner', 'supervisor', 'hr', 'clinical_director', 'finance',
  'psychiatrist_prescriber', 'nurse', 'therapist_clinician', 'case_manager',
  'behavioral_health_technician', 'peer_support_specialist', 'front_desk_admin',
  'facilities_support'
);

-- users.role
ALTER TABLE "users" ADD COLUMN "role_new" "UserRole_new";
UPDATE "users" SET "role_new" = CASE
  WHEN "role"::text = 'admin'  THEN 'supervisor'::"UserRole_new"
  WHEN "role"::text = 'worker' THEN 'front_desk_admin'::"UserRole_new"
  ELSE 'front_desk_admin'::"UserRole_new" END;
ALTER TABLE "users" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "users" RENAME COLUMN "role_new" TO "role";

-- invites.role (no default — D4)
ALTER TABLE "invites" ADD COLUMN "role_new" "UserRole_new";
UPDATE "invites" SET "role_new" = CASE
  WHEN "role"::text = 'admin'  THEN 'supervisor'::"UserRole_new"
  WHEN "role"::text = 'worker' THEN 'front_desk_admin'::"UserRole_new"
  ELSE 'front_desk_admin'::"UserRole_new" END;
ALTER TABLE "invites" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "invites" DROP COLUMN "role";
ALTER TABLE "invites" RENAME COLUMN "role_new" TO "role";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

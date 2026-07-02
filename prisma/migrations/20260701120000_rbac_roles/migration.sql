-- RBAC rollout: replace the two-value UserRole enum (admin | worker) with the
-- six granular roles. Existing data is migrated in place:
--   admin  -> supervisor   (facility admin; earliest per-org is later promoted
--                            to `owner` by scripts/backfill-roles.js)
--   worker -> worker
-- The `invites` column loses its DEFAULT (D4 — a role must be supplied on every
-- invite); the `users` column keeps its `worker` default.

CREATE TYPE "UserRole_new" AS ENUM (
  'owner', 'supervisor', 'hr', 'clinical_director', 'finance', 'worker'
);

-- users.role
ALTER TABLE "users" ADD COLUMN "role_new" "UserRole_new";
UPDATE "users" SET "role_new" = CASE
  WHEN "role"::text = 'admin'  THEN 'supervisor'::"UserRole_new"
  WHEN "role"::text = 'worker' THEN 'worker'::"UserRole_new"
  ELSE 'worker'::"UserRole_new" END;
ALTER TABLE "users" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "role_new" SET DEFAULT 'worker'::"UserRole_new";
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "users" RENAME COLUMN "role_new" TO "role";

-- invites.role (no default — D4)
ALTER TABLE "invites" ADD COLUMN "role_new" "UserRole_new";
UPDATE "invites" SET "role_new" = CASE
  WHEN "role"::text = 'admin'  THEN 'supervisor'::"UserRole_new"
  WHEN "role"::text = 'worker' THEN 'worker'::"UserRole_new"
  ELSE 'worker'::"UserRole_new" END;
ALTER TABLE "invites" ALTER COLUMN "role_new" SET NOT NULL;
ALTER TABLE "invites" DROP COLUMN "role";
ALTER TABLE "invites" RENAME COLUMN "role_new" TO "role";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

-- Organization → Organization + Facility split.
-- Creates a `facilities` table, seeds one facility per existing organisation
-- (carrying over the moved location/compliance/timezone fields), attaches every user to
-- their org's facility, then drops the moved columns from `organizations`.
-- Sequenced AFTER 20260701120000_rbac_roles. Authored-only — not yet applied.

-- gen_random_uuid() is native on PG13+; pgcrypto provides it on older versions.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "facilities" (
  "id"                       TEXT         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"          TEXT         NOT NULL,
  "name"                     TEXT         NOT NULL,
  "address"                  TEXT,
  "city"                     TEXT,
  "state"                    TEXT,
  "country"                  TEXT,
  "zip_code"                 TEXT,
  "phone"                    TEXT,
  "license_number"           TEXT,
  "staff_count"              TEXT,
  "program_services"         TEXT[]       NOT NULL DEFAULT '{}',
  "compliance_document_url"  TEXT,
  "compliance_document_name" TEXT,
  "timezone"                 TEXT,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "facilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "facilities_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "facilities_organization_id_idx" ON "facilities"("organization_id");

INSERT INTO "facilities" (
  "id","organization_id","name","address","city","state","country","zip_code",
  "phone","license_number","staff_count","program_services",
  "compliance_document_url","compliance_document_name","timezone","created_at","updated_at"
)
SELECT gen_random_uuid(), "id","name","address","city","state","country","zip_code",
  "phone","license_number","staff_count","program_services",
  "compliance_document_url","compliance_document_name","timezone","created_at",CURRENT_TIMESTAMP
FROM "organizations";

ALTER TABLE "users" ADD COLUMN "facility_id" TEXT;

UPDATE "users" u
SET "facility_id" = f."id"
FROM "facilities" f
WHERE f."organization_id" = u."organization_id";

CREATE INDEX "users_facility_id_idx" ON "users"("facility_id");
ALTER TABLE "users"
  ADD CONSTRAINT "users_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organizations"
  DROP COLUMN "address", DROP COLUMN "city", DROP COLUMN "state",
  DROP COLUMN "country", DROP COLUMN "zip_code", DROP COLUMN "phone",
  DROP COLUMN "license_number", DROP COLUMN "staff_count",
  DROP COLUMN "program_services", DROP COLUMN "compliance_document_url",
  DROP COLUMN "compliance_document_name", DROP COLUMN "timezone";

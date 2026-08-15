-- ─────────────────────────────────────────────────────────────────────────────
-- Org-scoped Document Hub categories.
--
-- Fully ADDITIVE: one new table plus a data backfill. No existing column or
-- constraint is touched, and `documents.category` stays the free-form string
-- snapshot it has always been.
--
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY this addition —
-- the diff engine otherwise tries to drop the raw-SQL-managed `manual_chunks`
-- pgvector column and the DB-level defaults on `facilities`.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "document_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_categories_organization_id_idx" ON "document_categories"("organization_id");

CREATE UNIQUE INDEX "document_categories_organization_id_name_key" ON "document_categories"("organization_id", "name");

ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1: every EXISTING organization gets the default vocabulary, so the
-- hub filter and the upload picker are never empty on deploy. New organizations
-- are seeded in application code at onboarding
-- (see `seedDefaultDocumentCategories` in src/lib/documents/document-categories.ts —
-- keep the two lists in step).
INSERT INTO "document_categories" ("id", "organization_id", "name")
SELECT gen_random_uuid()::text, o."id", defaults."name"
FROM "organizations" o
CROSS JOIN (VALUES ('HR'), ('Compliance'), ('Clinical'), ('Operations'), ('Training'), ('Other'))
  AS defaults("name")
ON CONFLICT ("organization_id", "name") DO NOTHING;

-- Backfill 2: any classification already in use that is NOT one of the defaults
-- (documents predate this table, and their category was free-form) becomes a
-- real category for its owning org — otherwise those documents would drop out
-- of the hub filter the moment it starts reading this table.
INSERT INTO "document_categories" ("id", "organization_id", "name")
SELECT gen_random_uuid()::text, ou."organization_id", btrim(d."category")
FROM "documents" d
JOIN "organization_users" ou ON ou."id" = d."organization_user_id"
WHERE d."category" IS NOT NULL AND btrim(d."category") <> ''
GROUP BY ou."organization_id", btrim(d."category")
ON CONFLICT ("organization_id", "name") DO NOTHING;

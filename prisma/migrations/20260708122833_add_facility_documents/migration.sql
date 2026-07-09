-- Onboarding compliance documents: files uploaded during the wizard's
-- credentialing step, linked to a facility once it is created.
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY the new table —
-- the diff engine otherwise tries to drop the raw-SQL-managed `manual_chunks`
-- pgvector column and the DB-level defaults on `facilities`.

CREATE TABLE "facility_documents" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "facility_documents_facility_id_idx" ON "facility_documents"("facility_id");

ALTER TABLE "facility_documents" ADD CONSTRAINT "facility_documents_facility_id_fkey"
  FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

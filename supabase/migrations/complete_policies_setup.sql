-- Migration: Complete Policies Table Setup
-- Description: Ensures policies table exists and adds document management columns

-- 1. Create policies table if it doesn't exist (from COMPLETE_SETUP.sql)
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID, -- Nullable to avoid dependency issues during setup
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- Changed to TEXT to avoid enum dependency
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add new columns for document management
ALTER TABLE policies 
ADD COLUMN IF NOT EXISTS document_category_id UUID REFERENCES document_categories(id),
ADD COLUMN IF NOT EXISTS uploaded_by UUID, -- Nullable, no FK constraint to users table
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(document_category_id);
CREATE INDEX IF NOT EXISTS idx_policies_org_category ON policies(organization_id, document_category_id);

-- 4. Create function to update category upload status
CREATE OR REPLACE FUNCTION update_category_upload_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the count and status when a policy is added or removed
  INSERT INTO category_upload_status (category_id, organization_id, documents_count, last_uploaded_at)
  VALUES (
    NEW.document_category_id,
    NEW.organization_id,
    1,
    NEW.created_at
  )
  ON CONFLICT (category_id, organization_id) 
  DO UPDATE SET
    documents_count = category_upload_status.documents_count + 1,
    last_uploaded_at = NEW.created_at,
    status = CASE 
      WHEN category_upload_status.documents_count + 1 >= (
        SELECT min_documents FROM document_categories WHERE id = NEW.document_category_id
      ) THEN 'completed'::TEXT
      ELSE 'in_progress'::TEXT
    END,
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger for automatic status updates
DROP TRIGGER IF EXISTS trigger_update_category_status ON policies;
CREATE TRIGGER trigger_update_category_status
  AFTER INSERT ON policies
  FOR EACH ROW
  WHEN (NEW.document_category_id IS NOT NULL)
  EXECUTE FUNCTION update_category_upload_status();

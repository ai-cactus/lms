-- Migration: Add Document Categories System
-- Description: Creates tables for hierarchical document management with types and categories

-- 1. Create document_types table
CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  slug TEXT NOT NULL UNIQUE,
  organization_id UUID,  -- Nullable, no FK constraint to avoid dependency
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create document_categories table
CREATE TABLE IF NOT EXISTS document_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_type_id UUID REFERENCES document_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  is_required BOOLEAN DEFAULT false,
  min_documents INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(document_type_id, slug)
);

-- 3. Update policies table to add category reference
-- NOTE: Uncomment this when you have the policies table created
-- ALTER TABLE policies 
-- ADD COLUMN IF NOT EXISTS document_category_id UUID REFERENCES document_categories(id),
-- ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id),
-- ADD COLUMN IF NOT EXISTS file_size BIGINT,
-- ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- 4. Create category_upload_status table for tracking
CREATE TABLE IF NOT EXISTS category_upload_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
  organization_id UUID,  -- Nullable, no FK constraint
  documents_count INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  last_uploaded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(category_id, organization_id)
);

-- 5. Create indexes for better query performance
-- NOTE: Uncomment these when you have the policies table created
-- CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(document_category_id);
-- CREATE INDEX IF NOT EXISTS idx_policies_org_category ON policies(organization_id, document_category_id);
CREATE INDEX IF NOT EXISTS idx_category_status_org ON category_upload_status(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_types_org ON document_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_categories_type ON document_categories(document_type_id);

-- 6-7. Create function and trigger to update category upload status
-- NOTE: Uncomment these when you have the policies table created
/*
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

DROP TRIGGER IF EXISTS trigger_update_category_status ON policies;
CREATE TRIGGER trigger_update_category_status
  AFTER INSERT ON policies
  FOR EACH ROW
  WHEN (NEW.document_category_id IS NOT NULL)
  EXECUTE FUNCTION update_category_upload_status();
*/

-- 8. Seed default document types (global, no organization_id)
INSERT INTO document_types (name, description, icon, slug, display_order) VALUES
('Organization & Governance Documents', 'policies, strategic plans, management guides, and executive reports', 'building', 'organization-governance', 1),
('Clinical & Working Documents', 'Patient care protocols, operational procedures, forms, and daily work guides', 'clipboard', 'clinical-working', 2)
ON CONFLICT (slug) DO NOTHING;

-- 9. Seed default categories for Organization & Governance
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Policies and Procedures', 'policies-procedures', 1),
  ('Personnel and Workforce Management', 'personnel-workforce', 2),
  ('Quality Management and Performance Improvement', 'quality-management', 3),
  ('Facility, Health, and Safety', 'facility-health-safety', 4),
  ('Financial and Administrative', 'financial-administrative', 5),
  ('Program-Specific Compliance', 'program-compliance', 6)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'organization-governance'
ON CONFLICT (document_type_id, slug) DO NOTHING;

-- 10. Seed default categories for Clinical & Working
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Patient Care Protocols', 'patient-care', 1),
  ('Operational Procedures', 'operational-procedures', 2),
  ('Forms and Templates', 'forms-templates', 3),
  ('Daily Work Guides', 'daily-work-guides', 4)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'clinical-working'
ON CONFLICT (document_type_id, slug) DO NOTHING;

COMMENT ON TABLE document_types IS 'Main document type categories (e.g., Organization & Governance)';
COMMENT ON TABLE document_categories IS 'Subcategories within document types for organizing uploads';
COMMENT ON TABLE category_upload_status IS 'Tracks upload completion status per category per organization';

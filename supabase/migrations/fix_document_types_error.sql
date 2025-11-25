-- Fix for missing document_types table and RLS policies

-- 1. Create tables if they don't exist
CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  slug TEXT NOT NULL UNIQUE,
  organization_id UUID,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

-- 2. Enable RLS
ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;

-- 3. Add Policies (Allow read for authenticated users)
DROP POLICY IF EXISTS "Allow read access for authenticated users" ON document_types;
CREATE POLICY "Allow read access for authenticated users" ON document_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read access for authenticated users" ON document_categories;
CREATE POLICY "Allow read access for authenticated users" ON document_categories
  FOR SELECT TO authenticated USING (true);

-- 4. Seed Data (if missing)
INSERT INTO document_types (name, description, icon, slug, display_order) VALUES
('Organization & Governance Documents', 'policies, strategic plans, management guides, and executive reports', 'building', 'organization-governance', 1),
('Clinical & Working Documents', 'Patient care protocols, operational procedures, forms, and daily work guides', 'clipboard', 'clinical-working', 2)
ON CONFLICT (slug) DO NOTHING;

-- 5. Seed default categories for Organization & Governance
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

-- 6. Seed default categories for Clinical & Working
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

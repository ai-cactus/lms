-- Add document_category_id to policies table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'document_category_id') THEN
        ALTER TABLE policies ADD COLUMN document_category_id UUID REFERENCES document_categories(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_policies_document_category_id ON policies(document_category_id);

-- Update RLS policies if needed (optional, but good practice)
-- Ensure users can only see policies in their organization (already exists usually, but good to verify)
-- DROP POLICY IF EXISTS "Users can view policies in their organization" ON policies;
-- CREATE POLICY "Users can view policies in their organization" ON policies
--     FOR SELECT USING (auth.uid() IN (
--         SELECT id FROM users WHERE organization_id = policies.organization_id
--     ));

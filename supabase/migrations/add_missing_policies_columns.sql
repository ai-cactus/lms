-- Add missing columns to policies table
DO $$
BEGIN
    -- Add file_size
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'file_size') THEN
        ALTER TABLE policies ADD COLUMN file_size BIGINT;
    END IF;

    -- Add mime_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'mime_type') THEN
        ALTER TABLE policies ADD COLUMN mime_type TEXT;
    END IF;

    -- Add uploaded_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'uploaded_by') THEN
        ALTER TABLE policies ADD COLUMN uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

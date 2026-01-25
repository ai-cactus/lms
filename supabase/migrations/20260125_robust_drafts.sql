-- Migration: Robust Course Drafts
-- Created: 2026-01-25
-- Description: Sets up course_drafts table, storage bucket, and cleanup function

-- 1. Create course_drafts table
CREATE TABLE IF NOT EXISTS course_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    draft_name TEXT,
    step INTEGER NOT NULL DEFAULT 1,
    course_data JSONB DEFAULT '{}'::jsonb,
    files_data JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_course_drafts_user_id ON course_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_course_drafts_updated_at ON course_drafts(updated_at);

-- 2. Enable RLS
ALTER TABLE course_drafts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid conflicts
DROP POLICY IF EXISTS "Users can manage their own drafts" ON course_drafts;

CREATE POLICY "Users can manage their own drafts"
    ON course_drafts
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- 3. Create Storage Bucket
-- (This might fail if the bucket already exists or if executed in an environment where storage.buckets is protected)
-- We use DO block to attempt it safely
DO $$
BEGIN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('course-drafts', 'course-drafts', false)
    ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not create storage bucket automatically. Please create "course-drafts" bucket manually.';
END $$;

-- 4. Storage Policies
-- We assume the file path structure: {user_id}/{draft_id}/{filename}

DROP POLICY IF EXISTS "Users can upload draft files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own draft files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own draft files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own draft files" ON storage.objects;

-- Helper function to check folder access
-- (Supabase storage.foldername() returns an array of folder parts)
-- We check if the first folder matches the user's ID

CREATE POLICY "Users can upload draft files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'course-drafts' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own draft files"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'course-drafts' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own draft files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'course-drafts' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own draft files"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'course-drafts' AND 
    (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. Cleanup Function
CREATE OR REPLACE FUNCTION cleanup_stale_drafts()
RETURNS void AS $$
BEGIN
    -- Delete drafts older than 30 days
    DELETE FROM course_drafts
    WHERE updated_at < NOW() - INTERVAL '30 days';
    
    -- Note: This does not automatically clean up the storage files.
    -- A separate trigger or cron job would be needed to clean up storage objects
    -- corresponding to deleted drafts, but for now this keeps the DB clean.
END;
$$ LANGUAGE plpgsql;

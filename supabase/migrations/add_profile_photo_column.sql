-- Migration: Add profile_photo_url column to users table
-- Run this in your Supabase SQL editor

-- Add profile_photo_url column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Add phone_number column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Create storage bucket for profile photos
-- Note: Run the bucket creation in Storage section of Supabase dashboard
-- OR use the following SQL (requires proper permissions):

-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('profile-photos', 'profile-photos', true)
-- ON CONFLICT (id) DO NOTHING;

-- Storage policy to allow authenticated users to upload their own photos
-- Run in SQL Editor:
/*
CREATE POLICY "Users can upload their own profile photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'profile-photos' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own profile photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'profile-photos' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Profile photos are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-photos');
*/

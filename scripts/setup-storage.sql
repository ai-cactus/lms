-- Create the 'policies' storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('policies', 'policies', true)
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for the 'policies' bucket

-- Allow authenticated users to upload files to their organization's folder
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'policies' AND
  (storage.foldername(name))[1] = (
    SELECT organization_id::text 
    FROM public.users 
    WHERE id = auth.uid()
  )
);

-- Allow authenticated users to view files in the 'policies' bucket
CREATE POLICY "Allow authenticated viewing"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'policies');

-- Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated updates"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'policies' AND
  owner = auth.uid()
);

-- Allow authenticated users to delete their own files
CREATE POLICY "Allow authenticated deletions"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'policies' AND
  owner = auth.uid()
);

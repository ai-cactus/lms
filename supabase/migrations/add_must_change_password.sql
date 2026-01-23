
-- Add must_change_password column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Update existing workers to NOT require password change (optional, helps migration)
UPDATE public.users 
SET must_change_password = false 
WHERE must_change_password IS NULL;

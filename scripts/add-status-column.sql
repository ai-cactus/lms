-- Add status column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended'));

-- Update existing users to have 'active' status if null
UPDATE users SET status = 'active' WHERE status IS NULL;

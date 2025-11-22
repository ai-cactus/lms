-- Add supervisor_id column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES users(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);

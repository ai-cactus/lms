-- Add job_title column to users table to store the CARF Role (e.g. "Direct Care Staff")
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS job_title text;

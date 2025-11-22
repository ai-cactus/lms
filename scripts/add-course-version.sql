-- Add version field to courses table for tracking content versions
-- This enables tracking which version of course content a worker completed

ALTER TABLE courses ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0';

-- Create index for efficient version queries
CREATE INDEX IF NOT EXISTS idx_courses_version ON courses(version);

-- Add comment for documentation
COMMENT ON COLUMN courses.version IS 'Version number of course content for tracking changes and compliance';

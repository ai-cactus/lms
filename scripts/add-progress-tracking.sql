-- Add progress_percentage column to course_assignments table
-- This will allow tracking worker progress through courses
ALTER TABLE course_assignments 
ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100);

-- Update existing records to set default progress based on status
UPDATE course_assignments 
SET progress_percentage = CASE 
    WHEN status = 'completed' THEN 100
    WHEN status = 'in_progress' THEN 0
    ELSE 0
END
WHERE progress_percentage IS NULL OR progress_percentage = 0;

-- Add explanation field to quiz_questions table
ALTER TABLE quiz_questions 
ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Add quiz time limit to courses table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS quiz_time_limit_minutes INTEGER DEFAULT 30;

-- Create lesson progress tracking table
CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID REFERENCES course_assignments(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sections_viewed TEXT[] DEFAULT '{}',
  last_section TEXT,
  progress_percentage INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, worker_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_lesson_progress_assignment ON lesson_progress(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_worker ON lesson_progress(worker_id);

-- Add updated_at trigger for lesson_progress
CREATE OR REPLACE FUNCTION update_lesson_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lesson_progress_updated_at ON lesson_progress;
CREATE TRIGGER trigger_update_lesson_progress_updated_at
    BEFORE UPDATE ON lesson_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_lesson_progress_updated_at();

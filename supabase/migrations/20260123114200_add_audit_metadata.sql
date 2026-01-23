-- Add metadata column to course_completions
ALTER TABLE course_completions
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add metadata column to quiz_attempts (check if exists first to be safe, though code relies on it)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quiz_attempts') THEN
        ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

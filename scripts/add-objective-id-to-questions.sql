-- Add objective_id to quiz_questions table
ALTER TABLE quiz_questions 
ADD COLUMN IF NOT EXISTS objective_id text;

-- Add comment
COMMENT ON COLUMN quiz_questions.objective_id IS 'ID of the course objective this question tests';

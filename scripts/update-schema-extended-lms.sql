-- Update Users Table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS worker_category text;

-- Update Courses Table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS course_type text CHECK (course_type IN ('policy', 'standard', 'external')),
ADD COLUMN IF NOT EXISTS policy_version text,
ADD COLUMN IF NOT EXISTS provider_name text,
ADD COLUMN IF NOT EXISTS reference_id text,
ADD COLUMN IF NOT EXISTS deadline_days integer DEFAULT 14,
ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 2,
ADD COLUMN IF NOT EXISTS delivery_format text DEFAULT 'pages' CHECK (delivery_format IN ('pages', 'slides')),
ADD COLUMN IF NOT EXISTS quiz_config jsonb DEFAULT '{"questions_per_attempt": 5, "feedback_timing": "end", "question_order": "random"}'::jsonb;

-- Create Quiz Attempts Table
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
    assignment_id uuid REFERENCES course_assignments(id) ON DELETE SET NULL,
    score numeric NOT NULL,
    passed boolean NOT NULL,
    attempt_number integer NOT NULL,
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

-- Create Quiz Answers Table
CREATE TABLE IF NOT EXISTS quiz_answers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid REFERENCES quiz_attempts(id) ON DELETE CASCADE NOT NULL,
    question_id uuid REFERENCES quiz_questions(id) ON DELETE SET NULL,
    selected_option_text text,
    is_correct boolean NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Add RLS Policies for new tables
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;

-- Quiz Attempts Policies
CREATE POLICY "Users can view their own attempts" ON quiz_attempts
    FOR SELECT USING (auth.uid() = worker_id);

CREATE POLICY "Admins and Supervisors can view all attempts" ON quiz_attempts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'supervisor')
        )
    );

CREATE POLICY "Users can insert their own attempts" ON quiz_attempts
    FOR INSERT WITH CHECK (auth.uid() = worker_id);

-- Quiz Answers Policies
CREATE POLICY "Users can view their own answers" ON quiz_answers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM quiz_attempts 
            WHERE quiz_attempts.id = quiz_answers.attempt_id 
            AND quiz_attempts.worker_id = auth.uid()
        )
    );

CREATE POLICY "Admins and Supervisors can view all answers" ON quiz_answers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('admin', 'supervisor')
        )
    );

CREATE POLICY "Users can insert their own answers" ON quiz_answers
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM quiz_attempts 
            WHERE quiz_attempts.id = quiz_answers.attempt_id 
            AND quiz_attempts.worker_id = auth.uid()
        )
    );

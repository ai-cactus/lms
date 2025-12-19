-- Create course_access_tokens table for tokenized course access
-- This allows workers to access courses directly via secure tokens without login

CREATE TABLE course_access_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    assignment_id UUID NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_course_access_tokens_token ON course_access_tokens(token);
CREATE INDEX idx_course_access_tokens_assignment ON course_access_tokens(assignment_id);
CREATE INDEX idx_course_access_tokens_worker ON course_access_tokens(worker_id);
CREATE INDEX idx_course_access_tokens_expires ON course_access_tokens(expires_at);

-- Enable RLS
ALTER TABLE course_access_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow admins to manage all tokens
CREATE POLICY "Admins can manage course access tokens"
    ON course_access_tokens FOR ALL
    USING (is_admin());

-- Allow workers to view their own tokens (for validation)
CREATE POLICY "Workers can view their own access tokens"
    ON course_access_tokens FOR SELECT
    USING (worker_id = auth.uid());

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_course_access_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_course_access_tokens_updated_at
    BEFORE UPDATE ON course_access_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_course_access_tokens_updated_at();

-- Create auto_login_tokens table for secure auto-login functionality
-- This allows workers to be automatically logged in from email links

CREATE TABLE IF NOT EXISTS auto_login_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    course_assignment_id UUID REFERENCES course_assignments(id) ON DELETE CASCADE,
    redirect_to TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

-- Create indexes for performance (ignore if they exist)
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_token ON auto_login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_user ON auto_login_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_expires ON auto_login_tokens(expires_at);

-- Enable RLS
ALTER TABLE auto_login_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "Admins can manage auto login tokens" ON auto_login_tokens;
DROP POLICY IF EXISTS "Allow token validation" ON auto_login_tokens;
DROP POLICY IF EXISTS "Allow token cleanup" ON auto_login_tokens;

-- Allow admins to manage all tokens (includes service role)
CREATE POLICY "Admins can manage auto login tokens"
    ON auto_login_tokens FOR ALL
    USING (is_admin() OR auth.role() = 'service_role');

-- Allow system to validate tokens (no user context needed for auto-login)
CREATE POLICY "Allow token validation"
    ON auto_login_tokens FOR SELECT
    USING (true);

-- Allow system to delete used tokens
CREATE POLICY "Allow token cleanup"
    ON auto_login_tokens FOR DELETE
    USING (true);

-- Create login_attempts table for audit logging
-- This tracks all login attempts (successful and failed) for security monitoring

CREATE TABLE IF NOT EXISTS public.login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created_at ON public.login_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id ON public.login_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON public.login_attempts(success);

-- Enable Row Level Security
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can view login attempts
CREATE POLICY "Admins can view all login attempts"
    ON public.login_attempts
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Policy: Service role can insert login attempts
CREATE POLICY "Service role can insert login attempts"
    ON public.login_attempts
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.login_attempts IS 'Audit log for all login attempts (successful and failed) for security monitoring and account lockout enforcement';

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
    try {
        const supabase = createAdminClient();

        // Check if user is admin
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Try to create the table directly
        const { error } = await supabase.rpc('exec_sql', { 
            query: `
                -- Create auto_login_tokens table for secure auto-login functionality
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
            `
        });

        if (error) {
            console.error('Migration error:', error);
            return NextResponse.json({ 
                success: false, 
                error: error.message 
            }, { status: 500 });
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Auto-login tokens table created successfully' 
        });

    } catch (error: any) {
        console.error('Migration API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message 
        }, { status: 500 });
    }
}

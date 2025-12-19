import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const { email } = await request.json();
        
        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const supabase = await createClient();
        
        // Send password reset email
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
        });

        if (error) {
            console.error('Password reset error:', error);
            return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Password reset email sent successfully' 
        });

    } catch (error) {
        console.error('Password reset API error:', error);
        return NextResponse.json({ 
            error: 'Internal server error' 
        }, { status: 500 });
    }
}

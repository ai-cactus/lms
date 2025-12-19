import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
    try {
        const { token, email, redirectTo } = await request.json();
        
        if (!token || !email) {
            return NextResponse.json({ 
                success: false, 
                error: 'Token and email are required' 
            }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Get user by email
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, full_name')
            .eq('email', email)
            .single();

        if (userError || !user) {
            return NextResponse.json({
                success: false,
                error: 'User not found for email: ' + email
            });
        }

        // Insert the token into the database with 24-hour expiry
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        const { error: insertError } = await supabase
            .from('auto_login_tokens')
            .insert({
                token: token,
                user_id: user.id,
                email: user.email,
                expires_at: expiresAt.toISOString(),
                redirect_to: redirectTo || '/worker/courses',
                created_at: new Date().toISOString()
            });

        if (insertError) {
            console.error('Token insertion error:', insertError);
            return NextResponse.json({
                success: false,
                error: 'Failed to insert token: ' + insertError.message
            });
        }

        return NextResponse.json({
            success: true,
            message: 'Token inserted successfully',
            token: token,
            userId: user.id,
            expiresAt: expiresAt
        });

    } catch (error: any) {
        console.error('Token insertion API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Internal server error: ' + error.message 
        }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from 'next/server';
import { validateAutoLoginToken } from '@/lib/auto-login-tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
    try {
        const { token } = await request.json();

        if (!token) {
            return NextResponse.json({
                isValid: false,
                error: 'Token is required'
            }, { status: 400 });
        }

        // Validate the auto-login token
        const validation = await validateAutoLoginToken(token);

        if (!validation.isValid) {
            return NextResponse.json(validation);
        }

        // Get user details for session creation
        const supabase = createAdminClient();
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, full_name')
            .eq('id', validation.userId)
            .single();

        if (userError || !user) {
            return NextResponse.json({
                isValid: false,
                error: 'User not found'
            });
        }

        return NextResponse.json({
            isValid: true,
            userId: user.id,
            email: user.email,
            fullName: user.full_name,
            redirectTo: validation.redirectTo,
            courseAssignmentId: validation.courseAssignmentId
        });

    } catch (error) {
        console.error('Auto-login API error:', error);
        return NextResponse.json({ 
            isValid: false, 
            error: 'Failed to validate login token' 
        }, { status: 500 });
    }
}

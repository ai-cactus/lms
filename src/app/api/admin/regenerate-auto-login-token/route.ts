import { NextRequest, NextResponse } from 'next/server';
import { generateAutoLoginToken, storeAutoLoginToken, generateAutoLoginUrl } from '@/lib/auto-login-tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
    try {
        const { email, redirectTo } = await request.json();
        
        if (!email) {
            return NextResponse.json({ 
                success: false, 
                error: 'Email is required' 
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
                error: 'User not found'
            });
        }

        // Generate new auto-login token
        const autoLoginToken = generateAutoLoginToken(
            user.id, 
            user.email, 
            undefined, // No specific course assignment
            redirectTo || '/worker/courses'
        );
        
        const tokenResult = await storeAutoLoginToken(autoLoginToken);
        
        if (!tokenResult.success) {
            return NextResponse.json({
                success: false,
                error: 'Failed to store token: ' + tokenResult.error
            });
        }

        // Generate the auto-login URL
        const autoLoginUrl = generateAutoLoginUrl(autoLoginToken.token, redirectTo);

        return NextResponse.json({
            success: true,
            token: autoLoginToken.token,
            autoLoginUrl: autoLoginUrl,
            expiresAt: autoLoginToken.expiresAt,
            userId: user.id
        });

    } catch (error: any) {
        console.error('Token regeneration API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Internal server error: ' + error.message 
        }, { status: 500 });
    }
}

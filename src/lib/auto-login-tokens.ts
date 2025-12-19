import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export interface AutoLoginToken {
    token: string;
    userId: string;
    email: string;
    expiresAt: Date;
    courseAssignmentId?: string; // Optional: direct course access
    redirectTo?: string; // Where to redirect after login
}

/**
 * Generate a secure auto-login token
 */
export function generateAutoLoginToken(
    userId: string, 
    email: string, 
    courseAssignmentId?: string, 
    redirectTo?: string
): AutoLoginToken {
    // Generate a cryptographically secure random token
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url'); // URL-safe base64
    
    // Token expires in 30 days (for now, as requested)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    return {
        token,
        userId,
        email,
        expiresAt,
        courseAssignmentId,
        redirectTo,
    };
}

/**
 * Store auto-login token in database
 */
export async function storeAutoLoginToken(tokenData: AutoLoginToken): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = createAdminClient();

        const { error } = await supabase
            .from('auto_login_tokens')
            .insert({
                token: tokenData.token,
                user_id: tokenData.userId,
                email: tokenData.email,
                expires_at: tokenData.expiresAt.toISOString(),
                course_assignment_id: tokenData.courseAssignmentId,
                redirect_to: tokenData.redirectTo,
                created_at: new Date().toISOString()
            });

        if (error) {
            console.error('Error storing auto-login token:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error storing auto-login token:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Validate and consume auto-login token
 */
export async function validateAutoLoginToken(token: string): Promise<{
    isValid: boolean;
    userId?: string;
    email?: string;
    courseAssignmentId?: string;
    redirectTo?: string;
    error?: string
}> {
    try {
        const supabase = createAdminClient();

        // Find the token and check if it's valid and not expired
        const { data: tokenData, error: tokenError } = await supabase
            .from('auto_login_tokens')
            .select('*')
            .eq('token', token)
            .single();

        if (tokenError || !tokenData) {
            return {
                isValid: false,
                error: 'Invalid or expired login token'
            };
        }

        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(tokenData.expires_at);
        if (now > expiresAt) {
            // Clean up expired token
            await supabase
                .from('auto_login_tokens')
                .delete()
                .eq('token', token);

            return {
                isValid: false,
                error: 'Login token has expired'
            };
        }
        
        // Token is valid, delete it (one-time use)
        await supabase
            .from('auto_login_tokens')
            .delete()
            .eq('token', token);
        
        return {
            isValid: true,
            userId: tokenData.user_id,
            email: tokenData.email,
            courseAssignmentId: tokenData.course_assignment_id,
            redirectTo: tokenData.redirect_to
        };
        
    } catch (error: any) {
        console.error('Error validating auto-login token:', error);
        return {
            isValid: false,
            error: 'Failed to validate login token'
        };
    }
}

/**
 * Generate auto-login URL
 */
export function generateAutoLoginUrl(token: string, redirectTo?: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const params = new URLSearchParams({
        token,
        ...(redirectTo && { redirect: redirectTo })
    });
    
    return `${baseUrl}/auth/auto-login?${params.toString()}`;
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Log a login attempt (successful or failed) for security auditing
 */
export async function logLoginAttempt({
    email,
    success,
    userId,
    errorMessage,
    ipAddress,
    userAgent
}: {
    email: string
    success: boolean
    userId?: string
    errorMessage?: string
    ipAddress?: string
    userAgent?: string
}) {
    try {
        const adminSupabase = createAdminClient()

        const { error } = await adminSupabase
            .from('login_attempts')
            .insert({
                user_id: userId || null,
                email: email.toLowerCase(),
                success,
                error_message: errorMessage || null,
                ip_address: ipAddress || null,
                user_agent: userAgent || null
            })

        if (error) {
            console.error('Failed to log login attempt:', error)
        }
    } catch (err) {
        console.error('Error logging login attempt:', err)
    }
}

/**
 * Check if an account is locked due to too many failed login attempts
 * Returns the unlock time if locked, null if not locked
 */
export async function checkAccountLockout(email: string): Promise<Date | null> {
    try {
        const adminSupabase = createAdminClient()

        // Get failed attempts in the last 15 minutes
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

        const { data: recentAttempts, error } = await adminSupabase
            .from('login_attempts')
            .select('created_at')
            .eq('email', email.toLowerCase())
            .eq('success', false)
            .gte('created_at', fifteenMinutesAgo)
            .order('created_at', { ascending: true })

        if (error) {
            console.error('Error checking account lockout:', error)
            return null
        }

        // If 5 or more failed attempts, account is locked
        if (recentAttempts && recentAttempts.length >= 5) {
            // Calculate unlock time (15 minutes after the first failed attempt)
            const firstAttempt = new Date(recentAttempts[0].created_at)
            const unlockTime = new Date(firstAttempt.getTime() + 15 * 60 * 1000)

            // If unlock time is in the future, return it
            if (unlockTime > new Date()) {
                return unlockTime
            }
        }

        return null
    } catch (err) {
        console.error('Error in checkAccountLockout:', err)
        return null
    }
}

/**
 * Request a password reset email
 */
export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()

        const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${origin}/auth/callback?next=/reset-password`
        })

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
}

/**
 * Update user password (called from reset-password page)
 */
export async function updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        })

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
}

/**
 * Sign out the current user and redirect to login page
 */
export async function signOut() {
    'use server'

    const supabase = await createClient()
    await supabase.auth.signOut()

    // Redirect is handled by middleware after signOut
    return { success: true }
}

/**
 * Change immediate password and clear force-change flag
 */
export async function changePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const adminSupabase = createAdminClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        // 1. Update Auth Password
        const { error: authError } = await supabase.auth.updateUser({
            password: newPassword
        })

        if (authError) {
            return { success: false, error: authError.message }
        }

        // 2. Clear force password flag
        const { error: profileError } = await adminSupabase
            .from('users')
            .update({ must_change_password: false })
            .eq('id', user.id)

        if (profileError) {
            console.error('Failed to clear password flag:', profileError)
            // Non-critical, but good to know
        }

        return { success: true }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
}

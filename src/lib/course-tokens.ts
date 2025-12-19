import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export interface CourseAccessToken {
    assignmentId: string;
    workerId: string;
    courseId: string;
    expiresAt: Date;
    token: string;
}

export interface TokenValidationResult {
    isValid: boolean;
    assignment?: {
        id: string;
        course_id: string;
        worker_id: string;
        status: string;
        deadline: string;
        course: {
            id: string;
            title: string;
            lesson_notes: string;
            objectives: string[];
            pass_mark: number;
        };
        worker: {
            id: string;
            full_name: string;
            email: string;
        };
    };
    error?: string;
}

/**
 * Generate a secure token for course access
 */
export function generateCourseAccessToken(assignmentId: string, workerId: string, courseId: string): CourseAccessToken {
    // Generate a cryptographically secure random token
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url'); // URL-safe base64
    
    // Token expires in 30 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    return {
        assignmentId,
        workerId,
        courseId,
        expiresAt,
        token
    };
}

/**
 * Store a course access token in the database
 */
export async function storeCourseAccessToken(tokenData: CourseAccessToken): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = createAdminClient();
        
        const { error } = await supabase
            .from('course_access_tokens')
            .insert({
                token: tokenData.token,
                assignment_id: tokenData.assignmentId,
                worker_id: tokenData.workerId,
                course_id: tokenData.courseId,
                expires_at: tokenData.expiresAt.toISOString(),
                created_at: new Date().toISOString()
            });
            
        if (error) {
            console.error('Error storing course access token:', error);
            return { success: false, error: error.message };
        }
        
        return { success: true };
    } catch (error: any) {
        console.error('Error storing course access token:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Validate a course access token and return assignment details
 */
export async function validateCourseAccessToken(token: string): Promise<TokenValidationResult> {
    try {
        const supabase = createAdminClient();
        
        // Find the token and check if it's valid and not expired
        const { data: tokenData, error: tokenError } = await supabase
            .from('course_access_tokens')
            .select('*')
            .eq('token', token)
            .single();
            
        if (tokenError || !tokenData) {
            return {
                isValid: false,
                error: 'Invalid or expired access token'
            };
        }
        
        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(tokenData.expires_at);
        if (now > expiresAt) {
            return {
                isValid: false,
                error: 'Access token has expired'
            };
        }
        
        // Get assignment details with course and worker info
        const { data: assignment, error: assignmentError } = await supabase
            .from('course_assignments')
            .select(`
                id,
                course_id,
                worker_id,
                status,
                deadline,
                course:courses (
                    id,
                    title,
                    lesson_notes,
                    objectives,
                    pass_mark
                ),
                worker:users!course_assignments_worker_id_fkey (
                    id,
                    full_name,
                    email
                )
            `)
            .eq('id', tokenData.assignment_id)
            .single();
            
        if (assignmentError || !assignment) {
            return {
                isValid: false,
                error: 'Assignment not found or access denied'
            };
        }
        
        // Verify the token matches the assignment
        if (assignment.worker_id !== tokenData.worker_id || assignment.course_id !== tokenData.course_id) {
            return {
                isValid: false,
                error: 'Token does not match assignment details'
            };
        }
        
        return {
            isValid: true,
            assignment: assignment as any
        };
        
    } catch (error: any) {
        console.error('Error validating course access token:', error);
        return {
            isValid: false,
            error: 'Failed to validate access token'
        };
    }
}

/**
 * Generate a complete course access URL
 */
export function generateCourseAccessUrl(token: string, baseUrl?: string): string {
    const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `${base}/course/access/${token}`;
}

/**
 * Clean up expired tokens (should be run periodically)
 */
export async function cleanupExpiredTokens(): Promise<{ deleted: number; error?: string }> {
    try {
        const supabase = createAdminClient();
        
        const { data, error } = await supabase
            .from('course_access_tokens')
            .delete()
            .lt('expires_at', new Date().toISOString())
            .select('id');
            
        if (error) {
            return { deleted: 0, error: error.message };
        }
        
        return { deleted: data?.length || 0 };
    } catch (error: any) {
        return { deleted: 0, error: error.message };
    }
}

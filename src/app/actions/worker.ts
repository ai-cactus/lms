'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type CreateWorkerState = {
    message?: string
    error?: string
    success?: boolean
}

export async function createWorker(prevState: CreateWorkerState, formData: FormData): Promise<CreateWorkerState> {
    try {
        const supabase = await createClient()
        const adminSupabase = createAdminClient()

        // 1. Verify current user is admin/supervisor
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        if (!currentUser) {
            return { error: 'Not authenticated' }
        }

        // Optional: Check if currentUser has role 'admin' or 'supervisor' in public.users
        // For now, we assume the page protection handles this, but good to double check in production.

        // 2. Extract data
        const email = formData.get('email') as string
        const fullName = formData.get('fullName') as string
        const role = formData.get('role') as string
        const category = formData.get('category') as string
        const supervisorId = formData.get('supervisorId') as string
        const organizationId = formData.get('organizationId') as string

        // Parse selected courses
        const carfCoursesJson = formData.get('carfCourses') as string
        const directCourseIdsJson = formData.get('directCourseIds') as string

        const carfCourses = carfCoursesJson ? JSON.parse(carfCoursesJson) : []
        const directCourseIds = directCourseIdsJson ? JSON.parse(directCourseIdsJson) : []

        if (!email || !fullName || !role || !category) {
            return { error: 'Missing required fields' }
        }

        // 3. Invite User via Supabase Auth (sends email if configured)
        // We use inviteUserByEmail which creates the user and sends a magic link
        const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const { data: authData, error: authError } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
            data: {
                full_name: fullName,
                role: 'worker', // Default auth metadata role
            },
            redirectTo: `${origin}/auth/callback`
        })

        if (authError) {
            console.error('Auth invite error:', authError)
            return { error: authError.message }
        }

        const newUserId = authData.user.id

        // 4. Insert into public.users
        const { error: profileError } = await adminSupabase
            .from('users')
            .upsert({
                id: newUserId,
                email: email,
                full_name: fullName,
                role: 'worker', // System role must be 'worker' (or 'supervisor' etc.)
                job_title: role, // Store the CARF Role (e.g. "Direct Care Staff") here
                worker_category: category,
                organization_id: organizationId || null,
                supervisor_id: supervisorId || null,
                status: 'active'
            })

        if (profileError) {
            console.error('Profile creation error:', profileError)
            return { error: 'Failed to create worker profile: ' + profileError.message }
        }

        // 5. Assign Courses
        // Ensure CARF courses exist
        let finalCourseIds = [...directCourseIds];

        if (carfCourses.length > 0) {
            const { ensureCoursesExist } = await import('./course');
            const { idMap, error: ensureError } = await ensureCoursesExist(carfCourses);

            if (ensureError) {
                console.error('Error ensuring courses exist:', ensureError);
                // We continue with what we have, or could return partial error
            }

            if (idMap) {
                finalCourseIds = [...finalCourseIds, ...Object.values(idMap)];
            }
        }

        if (finalCourseIds.length > 0) {
            const assignments = finalCourseIds.map((courseId: string) => ({
                course_id: courseId,
                worker_id: newUserId,
                assigned_by: currentUser.id,
                deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days default
                status: 'not_started'
            }))

            const { error: assignError } = await adminSupabase
                .from('course_assignments')
                .insert(assignments)

            if (assignError) {
                console.error('Assignment error:', assignError)
                // Non-critical error, but worth noting
                return { error: 'Worker created but failed to assign courses: ' + assignError.message, success: true }
            }
        }

        revalidatePath('/admin/workers')
        return { success: true, message: 'Worker invited successfully' }

    } catch (err: any) {
        console.error('Unexpected error:', err)
        return { error: 'An unexpected error occurred' }
    }


}

export async function updateWorker(prevState: CreateWorkerState, formData: FormData): Promise<CreateWorkerState> {
    try {
        const supabase = await createClient()
        const adminSupabase = createAdminClient()

        // 1. Verify current user is admin/supervisor
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        if (!currentUser) {
            return { error: 'Not authenticated' }
        }

        // 2. Extract data
        const workerId = formData.get('workerId') as string
        const fullName = formData.get('fullName') as string
        const email = formData.get('email') as string
        const role = formData.get('role') as string // Job Title
        const category = formData.get('category') as string
        const supervisorId = formData.get('supervisorId') as string
        const status = formData.get('status') as string

        if (!workerId || !fullName || !role || !category) {
            return { error: 'Missing required fields' }
        }

        // 3. Update public.users
        const updateData: any = {
            full_name: fullName,
            job_title: role,
            worker_category: category,
            supervisor_id: supervisorId || null,
        }

        if (status) {
            updateData.status = status
            if (status === 'inactive') {
                updateData.deactivated_at = new Date().toISOString()
            } else {
                updateData.deactivated_at = null
            }
        }

        // Only update email if changed (requires auth admin update too ideally, but for now just profile)
        // Note: Changing email in auth requires re-verification usually. 
        // For simplicity in this admin tool, we might restrict email changes or handle them carefully.
        // Let's update the profile email for display purposes, but warn if auth email is different.
        // Actually, let's try to update auth email too if possible.
        if (email) {
            updateData.email = email
            const { error: authUpdateError } = await adminSupabase.auth.admin.updateUserById(workerId, { email: email })
            if (authUpdateError) {
                console.error('Failed to update auth email:', authUpdateError)
                // We continue to update profile, but maybe return a warning?
                // For now, let's just log it.
            }
        }

        const { error: profileError } = await adminSupabase
            .from('users')
            .update(updateData)
            .eq('id', workerId)

        if (profileError) {
            console.error('Profile update error:', profileError)
            return { error: 'Failed to update worker profile: ' + profileError.message }
        }

        revalidatePath('/admin/workers')
        revalidatePath(`/admin/workers/${workerId}`)
        return { success: true, message: 'Worker updated successfully' }

    } catch (err: any) {
        console.error('Unexpected error:', err)
        return { error: 'An unexpected error occurred' }
    }
}

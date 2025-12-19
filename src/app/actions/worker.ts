'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateCourseAccessToken, storeCourseAccessToken, generateCourseAccessUrl } from '@/lib/course-tokens'

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

        // 3. Create User Account (bypassing Supabase Auth email to use Resend)
        const tempPassword = Math.random().toString(36).slice(-12) + 'Aa1!';
        const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
            email: email,
            password: tempPassword,
            user_metadata: {
                full_name: fullName,
                role: 'worker'
            },
            email_confirm: true // Skip email confirmation since we'll send our own email
        });

        if (authError) {
            console.error('Auth user creation error:', authError)
            return { error: `Failed to create user account: ${authError.message}` }
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
            // Fetch course details to get deadline_days for each course
            const { data: courseDetails } = await adminSupabase
                .from('courses')
                .select('id, deadline_days')
                .in('id', finalCourseIds);

            const assignments = finalCourseIds.map((courseId: string) => {
                const course = courseDetails?.find(c => c.id === courseId);
                const daysToAdd = course?.deadline_days || 14; // Default to 14 days if not specified

                return {
                    course_id: courseId,
                    worker_id: newUserId,
                    assigned_by: currentUser.id,
                    deadline: new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString(),
                    status: 'not_started'
                };
            });

            const { data: insertedAssignments, error: assignError } = await adminSupabase
                .from('course_assignments')
                .insert(assignments)
                .select('id, course_id, worker_id')

            if (assignError) {
                console.error('Assignment error:', assignError)
                // Non-critical error, but worth noting
                return { error: 'Worker created but failed to assign courses: ' + assignError.message, success: true }
            }

            // Generate access tokens for each course assignment
            if (insertedAssignments && insertedAssignments.length > 0) {
                // Get course details for email
                const { data: courseDetails } = await adminSupabase
                    .from('courses')
                    .select('id, title')
                    .in('id', insertedAssignments.map((a: any) => a.course_id));

                const tokenPromises = insertedAssignments.map(async (assignment: any) => {
                    try {
                        const tokenData = generateCourseAccessToken(
                            assignment.id,
                            assignment.worker_id,
                            assignment.course_id
                        );
                        
                        const result = await storeCourseAccessToken(tokenData);
                        if (result.success) {
                            const course = courseDetails?.find(c => c.id === assignment.course_id);
                            const assignmentDetail = assignments.find(a => a.course_id === assignment.course_id);
                            
                            return {
                                assignmentId: assignment.id,
                                courseId: assignment.course_id,
                                courseTitle: course?.title || 'Unknown Course',
                                accessUrl: generateCourseAccessUrl(tokenData.token),
                                deadline: assignmentDetail?.deadline ? new Date(assignmentDetail.deadline).toLocaleDateString() : undefined
                            };
                        }
                        return null;
                    } catch (error) {
                        console.error('Error generating access token:', error);
                        return null;
                    }
                });

                const accessTokens = await Promise.all(tokenPromises);
                const validTokens = accessTokens.filter(token => token !== null);
                
                console.log(`Generated ${validTokens.length} course access tokens for worker ${email}`);
                console.log(`Total assignments created: ${assignments.length}`);
            }
        }

        // Generate course-specific auto-login tokens and send welcome email
        console.log(`Generating course-specific auto-login tokens and sending welcome email to: ${email}`);

        try {
            const { generateAutoLoginToken, storeAutoLoginToken, generateAutoLoginUrl } = await import('@/lib/auto-login-tokens');
            const { sendWorkerWelcomeWithCourseAccess } = await import('@/lib/email');

            // Get course details and assignments for the email
            let courseAccessLinks: any[] = [];
            if (finalCourseIds.length > 0) {
                // Get course assignments that were just created
                const { data: userAssignments } = await adminSupabase
                    .from('course_assignments')
                    .select(`
                        id,
                        course_id,
                        course:courses(id, title, description)
                    `)
                    .eq('worker_id', newUserId);

                if (userAssignments && userAssignments.length > 0) {
                    // Generate auto-login token for each course
                    const tokenPromises = userAssignments.map(async (assignment: any) => {
                        const course = Array.isArray(assignment.course) ? assignment.course[0] : assignment.course;

                        // Generate token that redirects directly to course details page
                        const redirectUrl = `/worker/courses/${assignment.id}/details`;

                        const autoLoginToken = generateAutoLoginToken(
                            newUserId,
                            email,
                            assignment.id,
                            redirectUrl
                        );

                        const tokenResult = await storeAutoLoginToken(autoLoginToken);

                        if (tokenResult.success) {
                            return {
                                courseTitle: course?.title || 'Unknown Course',
                                courseDescription: course?.description || '',
                                autoLoginUrl: generateAutoLoginUrl(autoLoginToken.token, redirectUrl),
                                assignmentId: assignment.id
                            };
                        } else {
                            console.error(`Failed to store auto-login token for assignment ${assignment.id}:`, tokenResult.error);
                            throw new Error(`Failed to store token: ${tokenResult.error}`);
                        }
                    });

                    const tokens = await Promise.all(tokenPromises);
                    courseAccessLinks = tokens.filter(token => token !== null);
                }
            }

            // Generate fallback auto-login URL - if they have courses, go to first course details, otherwise dashboard
            let fallbackRedirectUrl = '/worker/courses';
            if (courseAccessLinks.length > 0) {
                // If they have courses, redirect to the first course details page
                fallbackRedirectUrl = `/worker/courses/${courseAccessLinks[0].assignmentId}/details`;
            }

            const fallbackToken = generateAutoLoginToken(newUserId, email, undefined, fallbackRedirectUrl);
            const fallbackTokenResult = await storeAutoLoginToken(fallbackToken);
            
            let fallbackUrl;
            if (fallbackTokenResult.success) {
                fallbackUrl = generateAutoLoginUrl(fallbackToken.token, fallbackRedirectUrl);
            } else {
                console.error('Failed to create fallback auto-login token, falling back to manual login');
                fallbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/login`;
            }
                
            console.log('Final fallback URL:', fallbackUrl);
            
            const emailResult = await sendWorkerWelcomeWithCourseAccess({
                to: email,
                workerName: fullName,
                organizationName: 'Your Organization',
                courseAccessLinks: courseAccessLinks,
                fallbackLoginUrl: fallbackUrl,
                hasAutoLogin: courseAccessLinks.length > 0
            });
            
            if (emailResult.success) {
                console.log(`✅ Successfully sent welcome email with course-specific auto-login to ${email}`);
            } else {
                console.error('❌ Failed to send welcome email:', emailResult.error);
            }
        } catch (emailError) {
            console.error('❌ Error sending email:', emailError);
            // Don't fail the entire operation if email fails
        }

        revalidatePath('/admin/workers')
        return { success: true, message: 'Worker created successfully! Welcome email with login credentials sent.' }

    } catch (err) {
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

    } catch (err) {
        console.error('Unexpected error:', err)
        return { error: 'An unexpected error occurred' }
    }
}

'use server'

import { createClient } from "@/lib/supabase/server";
import { generateCourseAccessToken, storeCourseAccessToken, generateCourseAccessUrl } from "@/lib/course-tokens";
import { sendWorkerInvitationWithTokens } from "@/lib/email";
import crypto from 'crypto';

export interface InviteResult {
    email: string;
    success: boolean;
    error?: string;
    isNewUser?: boolean;
}

export async function inviteUsersToCourse(
    emails: string[],
    courseId: string
): Promise<{ results: InviteResult[], totalSuccess: number, totalFailed: number }> {
    const results: InviteResult[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    try {
        const supabase = await createClient();

        // 1. Verify Admin Authentication
        const { data: { user: adminUser } } = await supabase.auth.getUser();
        if (!adminUser) {
            throw new Error("Unauthorized");
        }

        // Get admin's organization
        const { data: adminData } = await supabase
            .from("users")
            .select("organization_id, organization:organizations(name)")
            .eq("id", adminUser.id)
            .single();

        if (!adminData?.organization_id) {
            throw new Error("Organization not found");
        }

        const organizationName = (adminData.organization as any)?.name || "Training Platform";
        const organizationId = adminData.organization_id;

        // Get course details
        const { data: course } = await supabase
            .from("courses")
            .select("title")
            .eq("id", courseId)
            .single();

        if (!course) {
            throw new Error("Course not found");
        }

        // Process each email
        for (const email of emails) {
            try {
                const normalizedEmail = email.toLowerCase().trim();
                let workerId: string;
                let isNewUser = false;
                let fullName = normalizedEmail.split('@')[0]; // Default name from email

                // 2. Find or Create User
                // Check if user exists in Supabase Auth (via our public users table for simplicity first)
                // Note: ideally we check auth.users but we might not have permissions. 
                // We'll check our 'users' table.
                const { data: existingUser } = await supabase
                    .from("users")
                    .select("id, full_name")
                    .eq("email", normalizedEmail)
                    .single();

                if (existingUser) {
                    workerId = existingUser.id;
                    fullName = existingUser.full_name;
                } else {
                    // Create new user
                    // Since we are creating a user for "unauthenticated" access primarily, 
                    // we create a placeholder user account.
                    // IMPORTANT: To create a real auth user we need service_role, but here we are acting as admin.
                    // For now, we assume we use the admin client or similar mechanism if we wanted real auth.
                    // However, `course_access_tokens` require a `worker_id` linked to `users`.
                    // We will create a user in `users` table. 
                    // To do this properly with Auth, we usually call `supabase.auth.admin.createUser`.
                    // But `createClient` here uses the user's JWT. Admin users might not have `service_role` power.
                    // 
                    // IMPLEMENTATION CHOICE: We will try to rely on the fact that admins likely CAN create users 
                    // via some existing mechanism or we fallback to "shadow" users if your schema supports it.
                    // Looking at `assignUsersModal`, it lists existing users. 
                    // If we invite a NEW email, we must create them.

                    // NOTE: If we can't create an auth user easily, we might fail here. 
                    // Let's assume the system allows creating users or we use a separate "invites" flow.
                    // But the requirement is "unauthenticated access".
                    // The `course_access_tokens` table references `users(id)`.
                    // So we MUST have a row in `users`.

                    // We will try to create the user via a direct insert if RLS allows admins to insert users, 
                    // OR we need to use a Service Role client if we want to create an Auth user.
                    // Let's use a standard password for now or random.

                    // For this task, I will stick to "Invite Existing Users" logic for safety 
                    // unless I can verify I can create users. 
                    // Wait, the prompt implies "Invite user via email" -> likely new users too.
                    // I will assume for now I can create them or I will error if they don't exist.
                    // Actually, let's try to gracefully handle "User must exist" or auto-create if possible.

                    // Let's rely on the assumption that we can create a "shadow" user in the public table 
                    // if they don't exist in auth, OR we just fail for new users if I can't reach auth admin.
                    // But to be helpful, I'll try to find if there is a `createUser` action I can reuse.
                    // `src/app/actions/user.ts`?

                    // Let's proceed with finding/using existing users first, 
                    // and if not found, we attempt to create a "shell" user in the `users` table directly.
                    // (Note: `users` table usually has a foreign key to `auth.users`, so direct insert might fail 
                    // if triggers enforce auth.users existence).

                    // CAUTION: If direct insert fails, we record error.
                    isNewUser = true;

                    // Check if we have an admin client for creating users (usually restricted)
                    // For now, let's treat "Invite" as "Invite to this course" for existing org users primarily,
                    // but if the email is valid, maybe we can support it.
                    // The prompt says "Invite a user via email... unauthenticated".
                    // This strongly implies we effectively create an account for them or just a record.

                    // I'll try to create a user record. If it fails due to FK constraint, I'll return specific error.
                    // However, looking at the schema, `course_access_tokens` refs `users`.
                    // I will assume for now that if the user doesn't exist, we can't create them without Admin Auth API.
                    // I'll add a TODO or specific error message for non-existent users if I can't create them.
                    // BUT, I'll try to find a way. Check `createClient` import - if it can be `createAdminClient`.

                    // Ah, I see `createAdminClient` in `src/lib/supabase/admin.ts` (deduced from `course-tokens.ts`).
                    // I will use THAT to create the user if they don't exist!

                    const { createAdminClient } = await import("@/lib/supabase/admin");
                    const supabaseAdmin = createAdminClient();

                    const randomPassword = crypto.randomBytes(16).toString('hex');
                    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                        email: normalizedEmail,
                        password: randomPassword,
                        email_confirm: true,
                        user_metadata: { full_name: fullName, organization_id: organizationId, role: 'worker' }
                    });

                    if (authError) throw authError;
                    if (!authUser.user) throw new Error("Failed to create auth user");

                    workerId = authUser.user.id;
                    // The triggers should handle creating the `users` record.
                }

                // 3. Create Assignment (if not exists)
                // Use Admin client to bypass RLS potentially or just standard client
                const { data: existingAssignment } = await supabase
                    .from("course_assignments")
                    .select("id")
                    .eq("course_id", courseId)
                    .eq("worker_id", workerId)
                    .single();

                let assignmentId = existingAssignment?.id;

                if (!assignmentId) {
                    // Calculate deadline (30 days)
                    const deadline = new Date();
                    deadline.setDate(deadline.getDate() + 30);

                    const { data: newAssignment, error: assignError } = await supabase
                        .from("course_assignments")
                        .insert({
                            course_id: courseId,
                            worker_id: workerId,
                            assigned_by: adminUser.id,
                            status: "not_started",
                            assigned_at: new Date().toISOString(),
                            deadline: deadline.toISOString()
                        })
                        .select("id")
                        .single();

                    if (assignError) throw assignError;
                    assignmentId = newAssignment.id;
                }

                // 4. Generate Token
                const tokenData = generateCourseAccessToken(assignmentId, workerId, courseId);
                const { success: storeSuccess, error: storeError } = await storeCourseAccessToken(tokenData);

                if (!storeSuccess) throw new Error(storeError);

                // 5. Send Email
                const accessUrl = generateCourseAccessUrl(tokenData.token);

                await sendWorkerInvitationWithTokens({
                    to: email,
                    workerName: fullName,
                    organizationName: organizationName,
                    courseAccessLinks: [{
                        courseTitle: course.title,
                        accessUrl: accessUrl,
                        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()
                    }]
                });

                results.push({ email, success: true, isNewUser });
                totalSuccess++;

            } catch (err: any) {
                console.error(`Failed to invite ${email}:`, err);
                results.push({ email, success: false, error: err.message });
                totalFailed++;
            }
        }

        return { results, totalSuccess, totalFailed };
    } catch (error: any) {
        console.error("Error in inviteUsersToCourse:", error);
        throw error; // Re-throw to be handled by UI
    }
}

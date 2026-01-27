import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendWelcomeEmail, sendCourseAssignmentEmail } from "@/lib/email";

// Initialize Admin Client for User Management
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { email, courseTitle, inviterName, courseId, deadline } = body;

        if (!email || !courseTitle || !courseId) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        // Ensure the redirect handles login then course redirect
        // Typically: /login?next=/courses/[id] or /auth/callback?next=...
        // For existing users, direct link is fine if middleware handles protection.
        const courseUrl = `${appUrl}/courses/${courseId}`;

        // 1. Check if user exists
        const { data: existingUser } = await supabaseAdmin
            .from("users")
            .select("id, first_name, last_name, email")
            .eq("email", email)
            .single();

        if (existingUser) {
            // --- EXISTING USER CASE ---
            const userName = existingUser.first_name || "Team Member";
            const result = await sendCourseAssignmentEmail({
                to: email,
                userName,
                courseTitle,
                courseUrl,
                inviterName: inviterName || "Admin",
                deadline
            });
            return NextResponse.json(result);

        } else {
            // --- NEW USER CASE ---
            // Generate Invite Link (Does NOT send email from Supabase)
            const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
                type: "invite",
                email: email,
                options: {
                    redirectTo: `${appUrl}/auth/callback?next=/courses/${courseId}`
                }
            });

            if (linkError) {
                console.error("Error generating invite link:", linkError);
                return NextResponse.json({ error: "Failed to generate invite" }, { status: 500 });
            }

            const actionLink = linkData.properties.action_link;
            const organizationName = "Theraptly"; // Could be dynamic

            const result = await sendWelcomeEmail({
                to: email,
                organizationName,
                actionLink
            });

            // Note: We should probably create a placeholder 'users' record or 'course_assignments' record here
            // so that when they finally log in, the assignment is waiting.
            // But since they don't have a UUID yet (well, generateLink creates the auth user), we can assign now!

            if (linkData.user) {
                // Assign the course immediately to the new pending user
                // We need to fetch the admin user ID to set 'assigned_by' (passed in body? No, assume system/admin)
                // For now, we skip auto-assigning in DB for *invited* users here to keep it simple, 
                // OR we accept that the frontend loop over `send-invite` is done AFTER `handleComplete`.
                // Actually, handleComplete assumes users exist.
                // If we are inviting here, we should ideally insert into `course_assignments` with the new `linkData.user.id`.

                // Let's do a quick Best Effort assignment if possible.
                // Ideally, the caller should handle assignment, but the caller doesn't have the new User ID.
                // So we do it here.

                await supabaseAdmin.from("course_assignments").insert({
                    course_id: courseId,
                    worker_id: linkData.user.id,
                    status: "not_started",
                    assigned_at: new Date().toISOString(),
                    // assigned_by: ??? we don't have inviter UUID easily here unless passed.
                    // We will skip explicit DB assignment insert here to avoid constraint errors.
                    // The user will see the course "once assigned". 
                    // Wait, the prompt says "Courses will appear here once they’re assigned."
                    // So we SHOULD assign it.
                });
            }

            return NextResponse.json(result);
        }

    } catch (error) {
        console.error("API Error sending invite:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

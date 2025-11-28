"use server";

import { createClient } from "@/lib/supabase/server";

interface ImportResult {
    success: number;
    errors: { row: number; email: string; error: string }[];
}

export async function bulkImportWorkers(
    csvData: string,
    organizationId: string
): Promise<ImportResult> {
    const supabase = await createClient();

    // Verify authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        throw new Error("Not authenticated");
    }

    const result: ImportResult = {
        success: 0,
        errors: [],
    };

    try {
        // Parse CSV
        const lines = csvData.trim().split("\n");
        if (lines.length < 2) {
            throw new Error("CSV file is empty or invalid");
        }

        // Validate headers
        const headers = lines[0].toLowerCase().split(",").map(h => h.trim());
        const fullNameIndex = headers.indexOf("full_name");
        const emailIndex = headers.indexOf("email");
        const roleIndex = headers.indexOf("role");

        if (emailIndex === -1 || fullNameIndex === -1) {
            throw new Error("CSV must contain 'full_name' and 'email' columns");
        }

        // Process each row
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines

            const values = line.split(",").map(v => v.trim());
            const email = values[emailIndex];
            const fullName = values[fullNameIndex];
            const role = roleIndex !== -1 && values[roleIndex] ? values[roleIndex] : "worker";

            // Validate email
            if (!email || !email.includes("@")) {
                result.errors.push({
                    row: i + 1,
                    email: email || "(empty)",
                    error: "Invalid email address",
                });
                continue;
            }

            // Validate full name
            if (!fullName) {
                result.errors.push({
                    row: i + 1,
                    email,
                    error: "Full name is required",
                });
                continue;
            }

            try {
                // Check if user already exists
                const { data: existingUser } = await supabase
                    .from("users")
                    .select("id")
                    .eq("email", email)
                    .eq("organization_id", organizationId)
                    .single();

                if (existingUser) {
                    result.errors.push({
                        row: i + 1,
                        email,
                        error: "User already exists in this organization",
                    });
                    continue;
                }

                // Create user with Supabase Auth
                const tempPassword = Math.random().toString(36).slice(-12) + "Aa1!";
                const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
                    email,
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: {
                        organization_id: organizationId,
                        role: role,
                        full_name: fullName,
                    },
                });

                if (signUpError) {
                    result.errors.push({
                        row: i + 1,
                        email,
                        error: signUpError.message,
                    });
                    continue;
                }

                // Create user record in users table
                if (authData.user) {
                    const { error: insertError } = await supabase.from("users").insert({
                        id: authData.user.id,
                        email,
                        full_name: fullName,
                        role: role,
                        organization_id: organizationId,
                    });

                    if (insertError) {
                        result.errors.push({
                            row: i + 1,
                            email,
                            error: insertError.message,
                        });
                        continue;
                    }

                    // Send password reset email so worker can set their own password
                    try {
                        await supabase.auth.resetPasswordForEmail(email, {
                            redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/reset-password`,
                        });
                    } catch (emailError: any) {
                        console.error(`Failed to send reset email to ${email}:`, emailError);
                        // Don't fail the import if email fails, just log it
                    }

                    result.success++;
                }
            } catch (error: any) {
                result.errors.push({
                    row: i + 1,
                    email,
                    error: error.message || "Unknown error occurred",
                });
            }
        }

        return result;
    } catch (error: any) {
        throw new Error(`Failed to import workers: ${error.message}`);
    }
}

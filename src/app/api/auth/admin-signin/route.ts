import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
    try {
        const { userId, email } = await request.json();
        
        if (!userId || !email) {
            return NextResponse.json({ 
                success: false, 
                error: 'User ID and email are required' 
            }, { status: 400 });
        }

        const supabase = createAdminClient();

        // Get user details
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('email, full_name')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return NextResponse.json({
                success: false,
                error: 'User not found'
            });
        }

        // Use admin API to generate a session link that contains tokens
        console.log('Generating session for user:', user.email);
        
        // First ensure the auth user exists
        let authUserId = userId;
        try {
            const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
                email: user.email,
                password: 'TempPass123!', // Temporary password
                email_confirm: true,
                user_metadata: {
                    full_name: user.full_name
                }
            });
            
            if (authUser?.user?.id) {
                authUserId = authUser.user.id;
                console.log('Created new auth user:', authUserId);
            }
        } catch (createError: any) {
            if (createError.message?.includes('already registered')) {
                console.log('Auth user already exists for:', user.email);
                // Get the existing auth user ID
                const { data: existingUsers } = await supabase.auth.admin.listUsers();
                const existingUser = existingUsers.users.find(u => u.email === user.email);
                if (existingUser) {
                    authUserId = existingUser.id;
                    console.log('Found existing auth user:', authUserId);
                }
            } else {
                console.error('User creation error:', createError);
                return NextResponse.json({
                    success: false,
                    error: 'Failed to create auth user: ' + createError.message
                });
            }
        }

        // Create a session by signing in with a temporary password and immediately updating it
        // This avoids the redirect URL issue with generateLink
        console.log('Creating session for user:', user.email);

        try {
            // First, set a temporary password for the user (must meet Supabase requirements)
            const tempPassword = 'TempPass123!@#' + Date.now();

            console.log('Setting temporary password for user:', authUserId);
            const { error: updateError } = await supabase.auth.admin.updateUserById(authUserId, {
                password: tempPassword
            });

            if (updateError) {
                console.error('Error setting temp password:', updateError);

                // If password update fails, the user might already exist with a different password
                // Try to generate a new auth user instead
                console.log('Creating new auth user for:', user.email);

                const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
                    email: user.email,
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: {
                        full_name: user.full_name
                    }
                });

                if (createError && !createError.message?.includes('already registered')) {
                    console.error('Error creating new auth user:', createError);
                    return NextResponse.json({
                        success: false,
                        error: 'Failed to authenticate user: ' + updateError.message
                    });
                }

                if (newAuthUser?.user?.id) {
                    console.log('Created new auth user:', newAuthUser.user.id);
                    authUserId = newAuthUser.user.id;
                }
            }

            // Now sign in with the temp password to get tokens
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: tempPassword
            });

            if (signInError) {
                console.error('Error signing in:', signInError);
                return NextResponse.json({
                    success: false,
                    error: 'Failed to create session: ' + signInError.message
                });
            }

            console.log('Successfully created session for:', user.email);

            return NextResponse.json({
                success: true,
                session: {
                    access_token: signInData.session?.access_token,
                    refresh_token: signInData.session?.refresh_token
                },
                authUserId: authUserId,
                userId: userId
            });

        } catch (sessionError: any) {
            console.error('Session creation error:', sessionError);
            return NextResponse.json({
                success: false,
                error: 'Failed to create session: ' + sessionError.message
            });
        }

    } catch (error) {
        console.error('Admin sign-in API error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Internal server error' 
        }, { status: 500 });
    }
}

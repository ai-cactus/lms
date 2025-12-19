// Quick test script to check auto-login tokens
const { createClient } = require('@supabase/supabase-js');

async function testAutoLogin() {
    console.log('🔍 Testing auto-login token validation...\n');

    // You'll need to set these environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Missing environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Check if table exists by trying to query it
        console.log('1. Checking if auto_login_tokens table exists...');
        const { data: testQuery, error: tableError } = await supabase
            .from('auto_login_tokens')
            .select('id')
            .limit(1);

        if (tableError) {
            console.error('❌ auto_login_tokens table does not exist or error:', tableError.message);
            return;
        }

        console.log('✅ auto_login_tokens table exists');

        // Check for any tokens
        console.log('\n2. Checking for existing tokens...');
        const { data: tokens, error: tokenError } = await supabase
            .from('auto_login_tokens')
            .select('*')
            .limit(5);

        if (tokenError) {
            console.error('❌ Error fetching tokens:', tokenError);
            return;
        }

        console.log(`Found ${tokens?.length || 0} tokens`);
        if (tokens && tokens.length > 0) {
            tokens.forEach((token, i) => {
                console.log(`Token ${i + 1}:`, {
                    id: token.id,
                    token: token.token.substring(0, 20) + '...',
                    user_id: token.user_id,
                    email: token.email,
                    expires_at: token.expires_at,
                    created_at: token.created_at,
                    used_at: token.used_at
                });
            });
        }

        // Check if course_access_tokens table exists and has tokens
        console.log('\n4. Checking course_access_tokens table...');
        try {
            const { data: courseTokens, error: courseTokenError } = await supabase
                .from('course_access_tokens')
                .select('*')
                .limit(5);

            if (courseTokenError) {
                console.log('❌ course_access_tokens table error:', courseTokenError.message);
            } else {
                console.log(`Found ${courseTokens?.length || 0} course access tokens`);
                if (courseTokens && courseTokens.length > 0) {
                    courseTokens.forEach((token, i) => {
                        console.log(`Course Token ${i + 1}:`, {
                            id: token.id,
                            token: token.token.substring(0, 20) + '...',
                            assignment_id: token.assignment_id,
                            expires_at: token.expires_at,
                            created_at: token.created_at,
                            used_at: token.used_at
                        });
                    });
                }
            }
        } catch (error) {
            console.log('❌ Error checking course_access_tokens:', error.message);
        }

        // Check recent course assignments to see if tokens should exist
        console.log('\n5. Checking recent course assignments...');
        const { data: assignments, error: assignError } = await supabase
            .from('course_assignments')
            .select('id, worker_id, course_id, assigned_at, status')
            .order('assigned_at', { ascending: false })
            .limit(5);

        if (assignError) {
            console.error('❌ Error fetching assignments:', assignError);
        } else {
            console.log(`Found ${assignments?.length || 0} recent assignments`);
            if (assignments && assignments.length > 0) {
                assignments.forEach((assignment, i) => {
                    console.log(`Assignment ${i + 1}:`, {
                        id: assignment.id,
                        worker_id: assignment.worker_id,
                        course_id: assignment.course_id,
                        assigned_at: assignment.assigned_at,
                        status: assignment.status
                    });
                });
            }
        }

        // Test the specific token from the URL
        const testToken = '33OnUrOsXS6VRY21bYOOhqi-PmwUqoULmjgeSMkr7ug';
        console.log(`\n3. Testing specific token: ${testToken.substring(0, 20)}...`);

        const { data: testTokenData, error: testError } = await supabase
            .from('auto_login_tokens')
            .select('*')
            .eq('token', testToken)
            .single();

        if (testError) {
            console.log('❌ Token not found in auto_login_tokens table:', testError.message);
        } else {
            console.log('✅ Token found in auto_login_tokens:', {
                id: testTokenData.id,
                user_id: testTokenData.user_id,
                email: testTokenData.email,
                redirect_to: testTokenData.redirect_to,
                expires_at: testTokenData.expires_at,
                created_at: testTokenData.created_at,
                used_at: testTokenData.used_at
            });

            // Check if expired
            const now = new Date();
            const expiresAt = new Date(testTokenData.expires_at);
            console.log('Expiration check:', {
                now: now.toISOString(),
                expires_at: expiresAt.toISOString(),
                is_expired: now > expiresAt
            });
        }

        // Also check if this token exists in course_access_tokens
        console.log(`\n6. Checking if token exists in course_access_tokens...`);
        try {
            const { data: courseTestToken, error: courseTestError } = await supabase
                .from('course_access_tokens')
                .select('*')
                .eq('token', testToken)
                .single();

            if (courseTestError) {
                console.log('❌ Token not found in course_access_tokens either');
            } else {
                console.log('✅ Token found in course_access_tokens:', {
                    id: courseTestToken.id,
                    assignment_id: courseTestToken.assignment_id,
                    expires_at: courseTestToken.expires_at,
                    used_at: courseTestToken.used_at
                });
            }
        } catch (error) {
            console.log('❌ Error checking course_access_tokens:', error.message);
        }

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

testAutoLogin();

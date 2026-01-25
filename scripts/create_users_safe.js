require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Error: Missing environment variables.');
    console.error('Make sure .env.local exists and contains NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function createUsers() {
    console.log('Creating users...');

    // 1. Create Admin
    const { data: admin, error: adminError } = await supabase.auth.admin.createUser({
        email: 'admin@test.com',
        password: 'password123',
        email_confirm: true,
        user_metadata: {
            full_name: 'Safe Admin',
            organization_name: 'Safe Org', // Triggers org creation
            role: 'admin'
        }
    });

    if (adminError) console.error('Error creating admin:', adminError.message);
    else console.log('Admin created:', admin.user.email);

    // 2. Create Worker (Wait a bit to let Org creation trigger finish if needed, or query it finding the org)
    // Actually, we can just create the user. The trigger handles the org logic.
    // If we want them in the SAME org, we need to fetch the org ID first.
    // But for simplicity, let's just make the worker invite-style if we wanted strictness.
    // Or just create a separate worker. 
    // Let's try to fetch the org created by the admin to put the worker in it.

    // We need to wait for the trigger to run.
    console.log('Waiting for triggers...');
    await new Promise(r => setTimeout(r, 2000));

    // Create Worker
    const { data: worker, error: workerError } = await supabase.auth.admin.createUser({
        email: 'worker@test.com',
        password: 'password123',
        email_confirm: true,
        user_metadata: {
            full_name: 'Safe Worker',
            // If we don't provide org_id, it might create a user without org or fail depending on RLS/Triggers.
            // But our handle_new_user trigger defaults to new org if no ID provided?
            // "ELSIF new.raw_user_meta_data->>'organization_id' IS NOT NULL"
            // "ELSE No org info, skip profile creation" -> This is BAD for our test user unless we want them profile-less.
            // Let's just give them the same org name logic or different one.
            organization_name: 'Worker Org'
        }
    });

    if (workerError) console.error('Error creating worker:', workerError.message);
    else console.log('Worker created:', worker.user.email);

    console.log('\nDone! Login with password123');
}

createUsers();

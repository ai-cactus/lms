/**
 * Script to create test users - Simplified Version
 * 
 * This bypasses Supabase Auth's trigger issues by:
 * 1. Creating auth users with user_metadata only (no trigger dependency)
 * 2. Manually creating the organization and user profiles via direct inserts
 * 
 * Usage: node scripts/create-test-users-simple.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim().replace(/\r$/, '');
    }
});

// Initialize Supabase Admin Client
const supabaseAdmin = createClient(
    envVars.NEXT_PUBLIC_SUPABASE_URL,
    envVars.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Test users configuration
const TEST_USERS = {
    admin: {
        email: 'admin@test.com',
        password: 'Admin123!',
        full_name: 'Test Admin User',
        role: 'admin'
    },
    worker: {
        email: 'worker@test.com',
        password: 'Worker123!',
        full_name: 'Test Worker User',
        role: 'worker'
    }
};

const TEST_ORG = {
    name: 'Test Organization',
    program_type: 'Behavioral Health',
    license_number: 'TEST-12345'
};

async function createTestUsers() {
    console.log('🚀 Starting test user creation (simplified)...\n');

    try {
        // Step 1: Clean up any existing test users first
        console.log('🧹 Checking for existing test users...');

        // Find existing test users
        const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers();
        const testEmails = [TEST_USERS.admin.email, TEST_USERS.worker.email];

        for (const authUser of existingAuthUsers.users || []) {
            if (testEmails.includes(authUser.email)) {
                console.log(`   Deleting existing user: ${authUser.email}`);
                await supabaseAdmin.auth.admin.deleteUser(authUser.id);
            }
        }

        // Find and delete existing test organization
        const { data: existingOrgs } = await supabaseAdmin
            .from('organizations')
            .select('*')
            .eq('name', TEST_ORG.name);

        if (existingOrgs && existingOrgs.length > 0) {
            console.log(`   Deleting existing test organization...`);
            for (const org of existingOrgs) {
                await supabaseAdmin.from('organizations').delete().eq('id', org.id);
            }
        }

        console.log('✅ Cleanup complete\n');

        // Step 2: Create test organization directly
        console.log('📋 Creating test organization...');
        const { data: org, error: orgError } = await supabaseAdmin
            .from('organizations')
            .insert([TEST_ORG])
            .select()
            .single();

        if (orgError) {
            console.error('❌ Error creating organization:', orgError);
            return;
        }

        console.log('✅ Organization created:', org.id);
        console.log(`   Name: ${org.name}\n`);

        // Step 3: Create admin auth user (with minimal metadata)
        console.log('👤 Creating admin auth user...');
        const { data: adminAuthData, error: adminAuthError } = await supabaseAdmin.auth.admin.createUser({
            email: TEST_USERS.admin.email,
            password: TEST_USERS.admin.password,
            email_confirm: true,
            user_metadata: {} // Empty metadata to avoid trigger issues
        });

        if (adminAuthError) {
            console.error('❌ Error creating admin auth user:', adminAuthError);
            await supabaseAdmin.from('organizations').delete().eq('id', org.id);
            return;
        }

        console.log('✅ Admin auth user created:', adminAuthData.user.id);

        // Step 4: Create admin user profile directly
        console.log('👤 Creating admin profile...');
        const { error: adminProfileError } = await supabaseAdmin
            .from('users')
            .insert([{
                id: adminAuthData.user.id,
                organization_id: org.id,
                email: TEST_USERS.admin.email,
                full_name: TEST_USERS.admin.full_name,
                role: 'admin'
            }]);

        if (adminProfileError) {
            console.error('❌ Error creating admin profile:', adminProfileError);
            console.error('   Details:', JSON.stringify(adminProfileError, null, 2));
            return;
        }

        console.log('✅ Admin profile created');
        console.log(`   Email: ${TEST_USERS.admin.email}`);
        console.log(`   Password: ${TEST_USERS.admin.password}\n`);

        // Step 5: Create worker auth user
        console.log('👤 Creating worker auth user...');
        const { data: workerAuthData, error: workerAuthError } = await supabaseAdmin.auth.admin.createUser({
            email: TEST_USERS.worker.email,
            password: TEST_USERS.worker.password,
            email_confirm: true,
            user_metadata: {} // Empty metadata to avoid trigger issues
        });

        if (workerAuthError) {
            console.error('❌ Error creating worker auth user:', workerAuthError);
            return;
        }

        console.log('✅ Worker auth user created:', workerAuthData.user.id);

        // Step 6: Create worker profile directly
        console.log('👤 Creating worker profile...');
        const { error: workerProfileError } = await supabaseAdmin
            .from('users')
            .insert([{
                id: workerAuthData.user.id,
                organization_id: org.id,
                email: TEST_USERS.worker.email,
                full_name: TEST_USERS.worker.full_name,
                role: 'worker'
            }]);

        if (workerProfileError) {
            console.error('❌ Error creating worker profile:', workerProfileError);
            console.error('   Details:', JSON.stringify(workerProfileError, null, 2));
            return;
        }

        console.log('✅ Worker profile created');
        console.log(`   Email: ${TEST_USERS.worker.email}`);
        console.log(`   Password: ${TEST_USERS.worker.password}\n`);

        // Step 7: Verify everything was created
        console.log('🔍 Verifying users...');
        const { data: users, error: usersError } = await supabaseAdmin
            .from('users')
            .select('id, email, full_name, role, organization_id')
            .eq('organization_id', org.id);

        if (usersError) {
            console.error('❌ Error fetching users:', usersError);
        } else {
            console.log('✅ Users in database:');
            users.forEach(user => {
                console.log(`   - ${user.email} (${user.role})`);
            });
        }

        console.log('\n🎉 Test users created successfully!');
        console.log('\n📝 LOGIN CREDENTIALS:');
        console.log('═══════════════════════════════════════');
        console.log('ADMIN USER:');
        console.log(`  Email:    ${TEST_USERS.admin.email}`);
        console.log(`  Password: ${TEST_USERS.admin.password}`);
        console.log('\nWORKER USER:');
        console.log(`  Email:    ${TEST_USERS.worker.email}`);
        console.log(`  Password: ${TEST_USERS.worker.password}`);
        console.log('═══════════════════════════════════════\n');
        console.log('💡 You can now login at: http://localhost:3000/login\n');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Run the script
createTestUsers()
    .then(() => {
        console.log('✨ Script completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error);
        process.exit(1);
    });

/**
 * Create Test Users - Version 2
 * 
 * Prerequisites:
 * 1. Run scripts/fix-auth-trigger.sql in Supabase SQL Editor first
 * 
 * This creates:
 * - Admin user: admin@test.com / Admin123!
 * - Worker user: worker@test.com / Worker123!
 * 
 * Usage: node scripts/create-test-users-v2.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read environment variables
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim().replace(/\r$/, '');
    }
});

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

const TEST_USERS = {
    admin: {
        email: 'admin@test.com',
        password: 'Admin123!',
        full_name: 'Test Admin User'
    },
    worker: {
        email: 'worker@test.com',
        password: 'Worker123!',
        full_name: 'Test Worker User'
    }
};

const TEST_ORG = {
    name: 'Test Organization',
    program_type: 'Behavioral Health'
};

async function createTestUsers() {
    console.log('🚀 Creating test users...\n');

    try {
        // Step 1: Clean up existing test users
        console.log('🧹 Cleaning up existing test data...');
        const { data: authList } = await supabaseAdmin.auth.admin.listUsers();

        for (const user of authList.users || []) {
            if ([TEST_USERS.admin.email, TEST_USERS.worker.email].includes(user.email)) {
                console.log(`   Deleting: ${user.email}`);
                await supabaseAdmin.auth.admin.deleteUser(user.id);
            }
        }

        const { data: orgs } = await supabaseAdmin
            .from('organizations')
            .select('*')
            .eq('name', TEST_ORG.name);

        if (orgs && orgs.length > 0) {
            for (const org of orgs) {
                await supabaseAdmin.from('organizations').delete().eq('id', org.id);
            }
        }

        console.log('✅ Cleanup complete\n');

        // Step 2: Create admin user (will create org via trigger)
        console.log('👤 Creating admin user...');
        console.log('   This will create the organization automatically via trigger');

        const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
            email: TEST_USERS.admin.email,
            password: TEST_USERS.admin.password,
            email_confirm: true,
            user_metadata: {
                full_name: TEST_USERS.admin.full_name,
                organization_name: TEST_ORG.name,
                program_type: TEST_ORG.program_type
            }
        });

        if (adminError) {
            console.error('❌ Error creating admin user:', adminError);
            console.error('\n⚠️  Did you run scripts/fix-auth-trigger.sql first?');
            console.error('   Run it in Supabase SQL Editor, then try again.\n');
            return;
        }

        console.log('✅ Admin user created');
        console.log(`   ID: ${adminData.user.id}`);
        console.log(`   Email: ${TEST_USERS.admin.email}`);
        console.log(`   Password: ${TEST_USERS.admin.password}\n`);

        // Wait a moment for trigger to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 3: Get the organization ID
        const { data: adminProfile } = await supabaseAdmin
            .from('users')
            .select('organization_id')
            .eq('id', adminData.user.id)
            .single();

        if (!adminProfile || !adminProfile.organization_id) {
            console.error('❌ Admin profile not created!');
            console.error('   Trigger may have failed. Check Supabase logs.');
            return;
        }

        const orgId = adminProfile.organization_id;
        console.log(`📋 Organization ID: ${orgId}\n`);

        // Step 4: Create worker user
        console.log('👤 Creating worker user...');

        const { data: workerData, error: workerError } = await supabaseAdmin.auth.admin.createUser({
            email: TEST_USERS.worker.email,
            password: TEST_USERS.worker.password,
            email_confirm: true,
            user_metadata: {
                full_name: TEST_USERS.worker.full_name,
                organization_id: orgId
            }
        });

        if (workerError) {
            console.error('❌ Error creating worker user:', workerError);
            return;
        }

        console.log('✅ Worker user created');
        console.log(`   ID: ${workerData.user.id}`);
        console.log(`   Email: ${TEST_USERS.worker.email}`);
        console.log(`   Password: ${TEST_USERS.worker.password}\n`);

        // Step 5: Verify everything
        console.log('🔍 Verifying...');
        const { data: users } = await supabaseAdmin
            .from('users')
            .select('email, full_name, role')
            .eq('organization_id', orgId)
            .order('role', { ascending: false });

        if (users && users.length === 2) {
            console.log('✅ Both users created successfully:');
            users.forEach(u => {
                console.log(`   - ${u.email} (${u.role})`);
            });
        } else {
            console.warn('⚠️  Expected 2 users, found:', users?.length || 0);
        }

        console.log('\n🎉 Success! Test users are ready.\n');
        console.log('═══════════════════════════════════════');
        console.log('📝 LOGIN CREDENTIALS:');
        console.log('═══════════════════════════════════════');
        console.log('\nADMIN:');
        console.log(`  Email:    ${TEST_USERS.admin.email}`);
        console.log(`  Password: ${TEST_USERS.admin.password}`);
        console.log('\nWORKER:');
        console.log(`  Email:    ${TEST_USERS.worker.email}`);
        console.log(`  Password: ${TEST_USERS.worker.password}`);
        console.log('\n═══════════════════════════════════════');
        console.log('💡 Login at: http://localhost:3000/login\n');

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
        console.error('\nStack trace:', error.stack);
    }
}

createTestUsers()
    .then(() => {
        console.log('✨ Done');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Failed:', error);
        process.exit(1);
    });

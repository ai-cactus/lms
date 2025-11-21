/**
 * Create Test Users - Fixed Version
 * 
 * This creates users WITHOUT trying to list existing users first
 * (which was causing the "Database error checking email" issue)
 * 
 * Prerequisites: Run scripts/STEP1-disable-trigger.sql first
 * Usage: node scripts/create-users-no-trigger.js
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
    envVars.SUPABASE_SERVICE_ROLE_KEY
);

const ORG_ID = 'a0000000-0000-0000-0000-000000000001';

async function createTestUsers() {
    console.log('🚀 Creating test users...\n');

    try {
        // Don't list existing users - that causes "Database error"
        // Just create new users directly

        // Create admin
        console.log('👤 Creating admin...');
        const { data: admin, error: adminError } = await supabaseAdmin.auth.admin.createUser({
            email: 'admin@test.com',
            password: 'Admin123!',
            email_confirm: true
        });

        if (adminError) {
            console.error('❌ Admin creation failed:', adminError.message);
            if (adminError.message.includes('already exists') || adminError.message.includes('duplicate')) {
                console.log('   User might already exist. Run STEP1 SQL to clean up first.');
            }
            return;
        }

        console.log('✅ Admin created:', admin.user.id);

        // Create worker
        console.log('👤 Creating worker...');
        const { data: worker, error: workerError } = await supabaseAdmin.auth.admin.createUser({
            email: 'worker@test.com',
            password: 'Worker123!',
            email_confirm: true
        });

        if (workerError) {
            console.error('❌ Worker creation failed:', workerError.message);
            return;
        }

        console.log('✅ Worker created:', worker.user.id);

        // Create profiles
        console.log('\n📝 Creating profiles...');
        const { error: profileError } = await supabaseAdmin
            .from('users')
            .insert([
                {
                    id: admin.user.id,
                    organization_id: ORG_ID,
                    email: 'admin@test.com',
                    full_name: 'Test Admin User',
                    role: 'admin'
                },
                {
                    id: worker.user.id,
                    organization_id: ORG_ID,
                    email: 'worker@test.com',
                    full_name: 'Test Worker User',
                    role: 'worker'
                }
            ]);

        if (profileError) {
            console.error('❌ Profile creation failed:', profileError.message);
            return;
        }

        console.log('✅ Profiles created\n');

        // Verify (table query works, auth.users listing doesn't)
        const { data: users } = await supabaseAdmin
            .from('users')
            .select('email, role')
            .eq('organization_id', ORG_ID);

        if (users) {
            console.log('🔍 Created users:');
            users.forEach(u => console.log(`   ✓ ${u.email} (${u.role})`));
        }

        console.log('\n🎉 SUCCESS!\n');
        console.log('═══════════════════════════════════════');
        console.log('📝 LOGIN CREDENTIALS:');
        console.log('═══════════════════════════════════════');
        console.log('\nADMIN:');
        console.log('  Email:    admin@test.com');
        console.log('  Password: Admin123!');
        console.log('\nWORKER:');
        console.log('  Email:    worker@test.com');
        console.log('  Password: Worker123!');
        console.log('═══════════════════════════════════════\n');
        console.log('💡 Login at: http://localhost:3000/login\n');

        console.log('⚠️  FINAL STEP: Re-enable the trigger');
        console.log('Run this in Supabase SQL Editor:\n');
        console.log('CREATE TRIGGER on_auth_user_created');
        console.log('    AFTER INSERT ON auth.users');
        console.log('    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();\n');

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
        console.error('Stack:', error.stack);
    }
}

createTestUsers()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal:', err);
        process.exit(1);
    });

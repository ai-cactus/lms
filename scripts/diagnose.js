/**
 * Database Diagnostics
 * Check what's actually happening in the database
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function diagnose() {
    console.log('🔍 Running diagnostics...\n');

    // Check connection
    console.log('1. Testing Supabase connection...');
    const { data: testData, error: testError } = await supabaseAdmin
        .from('organizations')
        .select('count');

    if (testError) {
        console.error('❌ Connection failed:', testError.message);
        return;
    }
    console.log('✅ Connection OK\n');

    // Check organizations
    console.log('2. Checking organizations...');
    const { data: orgs, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*');

    if (orgError) {
        console.error('❌ Error:', orgError.message);
    } else {
        console.log(`   Found ${orgs.length} organization(s)`);
        orgs.forEach(o => console.log(`   - ${o.name} (${o.id})`));
    }
    console.log('');

    // Check users table
    console.log('3. Checking users table...');
    const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('*');

    if (userError) {
        console.error('❌ Error:', userError.message);
    } else {
        console.log(`   Found ${users.length} user(s)`);
        users.forEach(u => console.log(`   - ${u.email} (${u.role})`));
    }
    console.log('');

    // Check auth users
    console.log('4. Checking auth.users...');
    try {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();

        if (authError) {
            console.error('❌ Error:', authError.message);
        } else {
            console.log(`   Found ${authData.users.length} auth user(s)`);
            authData.users.forEach(u => console.log(`   - ${u.email} (${u.id})`));
        }
    } catch (err) {
        console.error('❌ Exception:', err.message);
    }
    console.log('');

    // Try to create a test user to see the exact error
    console.log('5. Testing user creation...');
    const testEmail = `test-${Date.now()}@example.com`;
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: testEmail,
        password: 'Test123!',
        email_confirm: true
    });

    if (createError) {
        console.error('❌ User creation failed:');
        console.error('   Error:', createError.message);
        console.error('   Status:', createError.status);
        console.error('   Code:', createError.code);
        if (createError.__isAuthError) {
            console.error('   This is an AUTH error from Supabase');
        }
    } else {
        console.log('✅ User creation succeeded!');
        console.log(`   Created: ${createData.user.email}`);
        console.log('   Cleaning up...');
        await supabaseAdmin.auth.admin.deleteUser(createData.user.id);
    }

    console.log('\n✨ Diagnostics complete');
}

diagnose()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });

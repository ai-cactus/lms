/**
 * Quick Test - Try creating users with different emails
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

async function test() {
    console.log('Testing different email patterns...\n');

    // Test 1: Random email (like diagnostic)
    console.log('1. Random email (test-timestamp@example.com)');
    const email1 = `test-${Date.now()}@example.com`;
    const { data: d1, error: e1 } = await supabaseAdmin.auth.admin.createUser({
        email: email1,
        password: 'Test123!',
        email_confirm: true
    });
    console.log(e1 ? `   ❌ ${e1.message}` : `   ✅ Success: ${d1.user.id}`);
    if (d1) await supabaseAdmin.auth.admin.deleteUser(d1.user.id);

    // Test 2: admin@test.com
    console.log('\n2. admin@test.com');
    const { data: d2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
        email: 'admin@test.com',
        password: 'Admin123!',
        email_confirm: true
    });
    console.log(e2 ? `   ❌ ${e2.message}` : `   ✅ Success: ${d2.user.id}`);

    // Test 3: Try searching for admin@test.com in auth
    console.log('\n3. Checking if admin@test.com already exists...');
    const { data: existing } = await supabaseAdmin
        .rpc('exec_sql', {
            sql: `SELECT id, email FROM auth.users WHERE email = 'admin@test.com';`
        })
        .catch(() => ({ data: null }));

    if (existing) {
        console.log('   Found existing user via RPC');
    } else {
        console.log('   Could not check via RPC');
    }

    console.log('\n✨ Test complete');
}

test()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });

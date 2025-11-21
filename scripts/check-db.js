/**
 * Script to check database trigger status
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

async function checkDatabase() {
    console.log('🔍 Checking database status...\n');

    // Check organizations
    const { data: orgs, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('*');

    console.log('Organizations:', orgs?.length || 0);
    if (orgs) orgs.forEach(o => console.log(`  - ${o.name} (${o.id})`));

    // Check users
    const { data: users, error: userError } = await supabaseAdmin
        .from('users')
        .select('*');

    console.log('\nUsers:', users?.length || 0);
    if (users) users.forEach(u => console.log(`  - ${u.email} (${u.role})`));

    // Check auth users
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
    console.log('\nAuth Users:', authData.users?.length || 0);
    if (authData.users) authData.users.forEach(u => console.log(`  - ${u.email}`));

    process.exit(0);
}

checkDatabase();

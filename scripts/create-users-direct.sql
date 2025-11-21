-- ============================================================================
-- CREATE TEST USERS - Direct Approach (No Trigger)
-- ============================================================================
-- This script:
-- 1. Temporarily disables the problematic auth trigger
-- 2. Creates test organization
-- 3. You'll create auth users via the Supabase Dashboard
-- 4. Creates user profiles manually
-- 5. Re-enables the trigger
--
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/_/sql
-- ============================================================================

-- Step 1: Disable the auth trigger temporarily
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Delete any existing test data
DELETE FROM public.users WHERE email IN ('admin@test.com', 'worker@test.com');
DELETE FROM public.organizations WHERE name = 'Test Organization';

-- Step 3: Create test organization
INSERT INTO public.organizations (id, name, program_type, license_number)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Test Organization',
    'Behavioral Health',
    'TEST-12345'
);

-- ============================================================================
-- IMPORTANT: Now create the auth users via Supabase Dashboard or API
-- ============================================================================
-- STOP HERE and follow these steps:
--
-- Option A: Use Supabase Dashboard (RECOMMENDED)
-- 1. Go to: https://app.supabase.com/project/iohrsbiubxgzgjcneble/auth/users
-- 2. Click "Invite User" or "Add User"
-- 3. Create admin user:
--    - Email: admin@test.com
--    - Password: Admin123!
--    - Auto Confirm: YES
-- 4. Create worker user:
--    - Email: worker@test.com  
--    - Password: Worker123!
--    - Auto Confirm: YES
-- 5. Note down the UUIDs of both users (they'll be visible in the users list)
-- 6. Come back here and run the rest of this script
--
-- Option B: Use the Node.js script
-- Run: node scripts/create-users-no-trigger.js
-- Then come back and run the rest of this script
--
-- ============================================================================

-- After creating auth users, update the IDs below with the actual UUIDs
-- and run the rest of this script:

-- Step 4: Create user profiles manually (REPLACE THE UUIDs!)
-- IMPORTANT: Replace 'YOUR-ADMIN-UUID-HERE' and 'YOUR-WORKER-UUID-HERE' 
-- with the actual UUIDs from the auth users you created above

/*
INSERT INTO public.users (id, organization_id, email, full_name, role)
VALUES 
    (
        'YOUR-ADMIN-UUID-HERE'::uuid,  -- Replace with actual admin user UUID
        'a0000000-0000-0000-0000-000000000001',
        'admin@test.com',
        'Test Admin User',
        'admin'
    ),
    (
        'YOUR-WORKER-UUID-HERE'::uuid,  -- Replace with actual worker user UUID
        'a0000000-0000-0000-0000-000000000001',
        'worker@test.com',
        'Test Worker User',
        'worker'
    );
*/

-- Step 5: Re-enable the trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 6: Verify
SELECT 'Setup complete! Verify below:' as status;
SELECT * FROM public.organizations WHERE name = 'Test Organization';
SELECT id, email, full_name, role FROM public.users WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';

-- If you see the users and organization, you're ready to login!

-- ============================================================================
-- ALL-IN-ONE: Create Test Users
-- ============================================================================
-- Copy this ENTIRE script and run it in Supabase SQL Editor
-- Then use the Node.js script to create the auth users
-- ============================================================================

-- Step 1: Disable the problematic trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Clean up any existing test data
DELETE FROM public.users WHERE email IN ('admin@test.com', 'worker@test.com');
DELETE FROM public.organizations WHERE name = 'Test Organization';

-- Step 3: Create test organization
INSERT INTO public.organizations (id, name, program_type, license_number)
VALUES (
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'Test Organization',
    'Behavioral Health',
    'TEST-12345'
);

-- Verify organization was created
SELECT 'Organization created:' as status, * FROM public.organizations WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- ============================================================================
-- NEXT STEP: Run this command in your terminal:
--   node scripts/create-users-no-trigger.js
-- 
-- This will create the auth users and their profiles.
-- The script will also re-enable the trigger automatically.
-- ============================================================================

SELECT '✅ Step 1 complete! Now run: node scripts/create-users-no-trigger.js' as next_step;

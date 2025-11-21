-- ============================================================================
-- CLEANUP SCRIPT - Delete ALL test data completely
-- ============================================================================
-- Run this in Supabase SQL Editor to completely reset test users
-- ============================================================================

-- IMPORTANT: This will delete EVERYTHING related to test@test.com emails
-- and the Test Organization

-- Step 1: Delete from public.users first (because of foreign keys)
DELETE FROM public.users 
WHERE email IN ('admin@test.com', 'worker@test.com')
   OR organization_id = 'a0000000-0000-0000-0000-000000000001';

-- Step 2: Delete from auth.users (this is what we were missing!)
-- Note: We need to use the auth schema directly
DELETE FROM auth.users 
WHERE email IN ('admin@test.com', 'worker@test.com');

-- Step 3: Delete the test organization
DELETE FROM public.organizations 
WHERE id = 'a0000000-0000-0000-0000-000000000001'
   OR name = 'Test Organization';

-- Verify everything is deleted
SELECT 'Cleanup verification:' as status;
SELECT 'Auth users:' as table_name, COUNT(*) as count FROM auth.users WHERE email LIKE '%test.com';
SELECT 'Public users:' as table_name, COUNT(*) as count FROM public.users WHERE email LIKE '%test.com';
SELECT 'Organizations:' as table_name, COUNT(*) as count FROM public.organizations WHERE name = 'Test Organization';

SELECT '✅ Cleanup complete! Now run STEP1-disable-trigger.sql again.' as message;

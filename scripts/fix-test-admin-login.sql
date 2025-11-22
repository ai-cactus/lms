-- Check if test admin account exists and reset lockout
-- Run this in Supabase SQL Editor

-- 1. Check if admin@test.com exists in auth.users
SELECT id, email, created_at, confirmed_at 
FROM auth.users 
WHERE email = 'admin@test.com';

-- 2. Check if admin@test.com exists in public.users
SELECT id, email, role, full_name, organization_id, deactivated_at
FROM public.users
WHERE email = 'admin@test.com';

-- 3. Clear any login lockouts for this account
DELETE FROM login_attempts
WHERE email = 'admin@test.com';

-- 4. If the user exists but you forgot the password, you can reset it via Supabase Dashboard:
--    Go to: Authentication > Users > Find admin@test.com > Click "..." > Send password reset email
--    OR manually set a new password in the dashboard

-- 5. If the user doesn't exist at all, you need to create it.
--    The safest way is to use the "Add Worker" flow in the admin panel
--    OR use Supabase Dashboard: Authentication > Users > Invite user

-- NOTES:
-- - The password should be: Admin123!
-- - Make sure the user exists in BOTH auth.users AND public.users
-- - Make sure the role in public.users is 'admin'

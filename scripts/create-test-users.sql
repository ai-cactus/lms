-- ============================================================================
-- CREATE TEST USERS - SQL Script
-- ============================================================================
-- Run this in your Supabase SQL Editor to create test users
-- This bypasses the trigger issues by temporarily disabling it
-- ============================================================================

-- Step 1: Temporarily disable the auth trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Create a test organization
INSERT INTO public.organizations (id, name, program_type, license_number)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Test Organization',
    'Behavioral Health',
    'TEST-12345'
)
ON CONFLICT (id) DO NOTHING;

-- Step 3: Create test admin user in auth.users
-- Note: Passwords need to be hashed. We'll use a simple approach here
-- The password 'Admin123!' hashed with bcrypt
INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    aud,
    role
)
VALUES (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000000',
    'admin@test.com',
    '$2a$10$YfQEh.L3cN5h9aGTqYYjj.Ol4xJ2/n7H3qJOqH0qD1j6QmN5h9aGT', -- This is a placeholder, see note below
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Test Admin User"}',
    NOW(),
    NOW(),
    '',
    'authenticated',
    'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- Step 4: Create admin user profile
INSERT INTO public.users (id, organization_id, email, full_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000001',
    'admin@test.com',
    'Test Admin User',
    'admin'
)
ON CONFLICT (id) DO NOTHING;

-- Step 5: Create test worker user in auth.users
INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    aud,
    role
)
VALUES (
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000000',
    'worker@test.com',
    '$2a$10$YfQEh.L3cN5h9aGTqYYjj.Ol4xJ2/n7H3qJOqH0qD1j6QmN5h9aGT', -- This is a placeholder, see note below
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Test Worker User"}',
    NOW(),
    NOW(),
    '',
    'authenticated',
    'authenticated'
)
ON CONFLICT (id) DO NOTHING;

-- Step 6: Create worker user profile
INSERT INTO public.users (id, organization_id, email, full_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000001',
    'worker@test.com',
    'Test Worker User',
    'worker'
)
ON CONFLICT (id) DO NOTHING;

-- Step 7: Re-enable the auth trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- IMPORTANT NOTE ABOUT PASSWORDS:
-- ============================================================================
-- The encrypted_password above is a PLACEHOLDER and won't work for login.
-- Instead, use the Supabase Dashboard to reset the passwords:
-- 1. Go to Authentication > Users in your Supabase Dashboard
-- 2. Click on each user (admin@test.com and worker@test.com)
-- 3. Click "Send password reset email" OR manually set password to: Admin123! / Worker123!
-- 
-- Alternatively, use the API approach in the Node.js script below
-- ============================================================================

SELECT 'Test users created successfully!' as message;
SELECT 'Admin: admin@test.com' as admin_user;
SELECT 'Worker: worker@test.com' as worker_user;
SELECT 'Please reset passwords via Supabase Dashboard or use the Node.js script' as note;

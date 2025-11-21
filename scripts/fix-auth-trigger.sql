-- ============================================================================
-- FIX AUTH TRIGGER - Make it more robust
-- ============================================================================
-- This updates the handle_new_user() trigger to be more fault-tolerant
-- Run this in your Supabase SQL Editor FIRST, then run the Node.js script
-- ============================================================================

-- Drop and recreate the trigger function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    org_name TEXT;
    prog_type TEXT;
    user_full_name TEXT;
    user_role user_role;
BEGIN
    -- Log the trigger execution (for debugging)
    RAISE NOTICE 'handle_new_user triggered for user: %', new.email;
    
    -- Extract metadata from the new user
    org_name := new.raw_user_meta_data->>'organization_name';
    prog_type := new.raw_user_meta_data->>'program_type';
    user_full_name := new.raw_user_meta_data->>'full_name';
    
    -- Check if this is a new organization signup (admin)
    IF org_name IS NOT NULL AND org_name != '' THEN
        RAISE NOTICE 'Creating new organization: %', org_name;
        
        -- This is a new Organization Signup (Admin)
        INSERT INTO public.organizations (name, program_type)
        VALUES (org_name, COALESCE(prog_type, 'Behavioral Health'))
        RETURNING id INTO new_org_id;
        
        user_role := 'admin';
        
    -- Check if this is an invited worker
    ELSIF new.raw_user_meta_data->>'organization_id' IS NOT NULL THEN
        RAISE NOTICE 'Adding user to existing organization';
        
        new_org_id := (new.raw_user_meta_data->>'organization_id')::UUID;
        user_role := 'worker';
        
    ELSE
        -- No org info - this might be a password reset or other auth event
        -- Skip profile creation
        RAISE NOTICE 'Skipping profile creation - no organization metadata';
        RETURN new;
    END IF;

    -- Create the User Profile
    RAISE NOTICE 'Creating user profile for: % with role: %', new.email, user_role;
    
    INSERT INTO public.users (id, organization_id, email, full_name, role)
    VALUES (
        new.id,
        new_org_id,
        new.email,
        COALESCE(user_full_name, 'New User'),
        user_role
    );
    
    RAISE NOTICE 'User profile created successfully';
    RETURN new;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error details
        RAISE WARNING 'Error in handle_new_user: % - %', SQLERRM, SQLSTATE;
        RAISE WARNING 'User email: %, Organization ID: %', new.email, new_org_id;
        
        -- Re-raise the exception to fail the auth creation
        -- This prevents orphaned auth users without profiles
        RAISE EXCEPTION 'Failed to create user profile: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

SELECT 'Trigger updated successfully! Now run: node scripts/create-test-users-v2.js' as message;

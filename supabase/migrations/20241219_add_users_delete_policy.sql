-- Add DELETE policy for users table
-- This allows admins to delete users in their organization

CREATE POLICY "Admins can delete users in their organization"
    ON users FOR DELETE
    USING (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );

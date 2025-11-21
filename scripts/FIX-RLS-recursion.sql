-- Fix RLS Infinite Recursion
-- This script breaks the cyclic dependency between courses and course_assignments policies

-- 1. Create helper function to check assignment (SECURITY DEFINER breaks recursion)
-- This function runs with elevated privileges to check assignments without triggering RLS on course_assignments again
CREATE OR REPLACE FUNCTION is_worker_assigned_to_course(c_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM course_assignments
        WHERE course_id = c_id
        AND worker_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update Courses Policy to use the helper
DROP POLICY IF EXISTS "Users can view courses in their organization" ON courses;

CREATE POLICY "Users can view courses in their organization"
    ON courses FOR SELECT
    USING (
        organization_id = get_auth_user_organization_id()
        OR
        is_worker_assigned_to_course(id)
    );

-- 3. Ensure Course Assignments Policy is simple and direct
DROP POLICY IF EXISTS "Workers can view their own assignments" ON course_assignments;

CREATE POLICY "Workers can view their own assignments"
    ON course_assignments FOR SELECT
    USING (worker_id = auth.uid());

-- 4. Verification Query
-- This should now return data without error for the worker
SELECT 
    c.title,
    ca.status
FROM course_assignments ca
JOIN courses c ON c.id = ca.course_id
WHERE ca.worker_id = auth.uid();

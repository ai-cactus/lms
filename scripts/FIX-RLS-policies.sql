-- Fix RLS policies for Worker Dashboard

-- 1. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Workers can view their own assignments" ON course_assignments;
DROP POLICY IF EXISTS "Users can view courses in their organization" ON courses;

-- 2. Re-create Course Assignments Policy (Simple & Direct)
CREATE POLICY "Workers can view their own assignments"
    ON course_assignments FOR SELECT
    USING (worker_id = auth.uid());

-- 3. Re-create Courses Policy (Allow seeing courses if assigned OR in same org)
CREATE POLICY "Users can view courses in their organization"
    ON courses FOR SELECT
    USING (
        organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())
        OR
        id IN (SELECT course_id FROM course_assignments WHERE worker_id = auth.uid())
    );

-- 4. Grant permissions (just in case)
GRANT SELECT ON course_assignments TO authenticated;
GRANT SELECT ON courses TO authenticated;

-- 5. Verify the data exists
SELECT 
    u.email, 
    u.role, 
    u.organization_id as user_org, 
    c.title as course_title, 
    c.organization_id as course_org,
    ca.status as assignment_status
FROM users u
JOIN course_assignments ca ON ca.worker_id = u.id
JOIN courses c ON c.id = ca.course_id
WHERE u.email = 'worker@test.com';

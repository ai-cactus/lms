-- Fix for missing RLS policy allowing workers to update their own assignments
-- This is required for updating the status to 'in_progress' and 'completed'

-- Enable UPDATE for workers on course_assignments
CREATE POLICY "Workers can update their own assignments"
    ON course_assignments FOR UPDATE
    USING (worker_id = auth.uid());

-- Verify the policy was created
SELECT * FROM pg_policies WHERE tablename = 'course_assignments';

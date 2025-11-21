-- ============================================================================
-- FIX: Add missing RLS policies for quiz_questions
-- ============================================================================

-- 1. Allow Admins to manage (INSERT, UPDATE, DELETE, SELECT) quiz questions for courses in their organization
CREATE POLICY "Admins can manage quiz questions"
ON quiz_questions
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM courses
        WHERE courses.id = quiz_questions.course_id
        AND courses.organization_id = get_auth_user_organization_id()
        AND is_admin()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM courses
        WHERE courses.id = course_id
        AND courses.organization_id = get_auth_user_organization_id()
        AND is_admin()
    )
);

-- 2. Allow Workers to view quiz questions for courses they are assigned to
CREATE POLICY "Workers can view quiz questions for assigned courses"
ON quiz_questions
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM course_assignments
        WHERE course_assignments.course_id = quiz_questions.course_id
        AND course_assignments.worker_id = auth.uid()
    )
);

-- ============================================================================
-- Verification: Check if policies exist
-- ============================================================================
SELECT tablename, policyname, cmd, roles 
FROM pg_policies 
WHERE tablename = 'quiz_questions';

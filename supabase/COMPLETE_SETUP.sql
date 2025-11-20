-- ============================================================================
-- THERAPTLY LMS - COMPLETE DATABASE SETUP
-- ============================================================================
-- This script sets up everything from scratch.
-- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql
-- ============================================================================

-- ============================================================================
-- CLEANUP (Drop policies first, then functions)
-- ============================================================================

-- Drop policies first (they depend on functions)
DROP POLICY IF EXISTS "Users can view their own organization" ON organizations;
DROP POLICY IF EXISTS "Users can view users in their organization" ON users;
DROP POLICY IF EXISTS "Admins can insert users in their organization" ON users;
DROP POLICY IF EXISTS "Admins can update users in their organization" ON users;
DROP POLICY IF EXISTS "Users can view policies in their organization" ON policies;
DROP POLICY IF EXISTS "Admins can manage policies" ON policies;
DROP POLICY IF EXISTS "Users can view courses in their organization" ON courses;
DROP POLICY IF EXISTS "Admins can manage courses" ON courses;
DROP POLICY IF EXISTS "Workers can view their own assignments" ON course_assignments;
DROP POLICY IF EXISTS "Admins can manage all assignments in their organization" ON course_assignments;
DROP POLICY IF EXISTS "Workers can view and create their own completions" ON course_completions;
DROP POLICY IF EXISTS "Admins can manage all confirmations in their organization" ON admin_confirmations;

-- Now drop triggers and functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_policies_updated_at ON policies;
DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
DROP TRIGGER IF EXISTS update_course_assignments_updated_at ON course_assignments;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.get_auth_user_organization_id();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- Drop all tables (in reverse dependency order)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS retraining_logs CASCADE;
DROP TABLE IF EXISTS admin_confirmations CASCADE;
DROP TABLE IF EXISTS course_completions CASCADE;
DROP TABLE IF EXISTS course_assignments CASCADE;
DROP TABLE IF EXISTS quiz_questions CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS policies CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- Drop enums last
DROP TYPE IF EXISTS assignment_status CASCADE;
DROP TYPE IF EXISTS policy_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================
CREATE TYPE user_role AS ENUM ('admin', 'worker');
CREATE TYPE policy_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE assignment_status AS ENUM ('not_started', 'in_progress', 'pending_confirmation', 'completed', 'overdue');

-- ============================================================================
-- TABLES
-- ============================================================================

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    program_type TEXT NOT NULL,
    license_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'worker',
    deactivated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Policies table
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status policy_status NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Courses table
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id UUID REFERENCES policies(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    objectives JSONB NOT NULL DEFAULT '[]',
    lesson_notes TEXT NOT NULL,
    pass_mark INTEGER NOT NULL DEFAULT 80,
    attempts_allowed INTEGER NOT NULL DEFAULT 2,
    carf_standards JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quiz questions table
CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'multiple_choice',
    options JSONB NOT NULL DEFAULT '[]',
    correct_answer TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Course assignments table
CREATE TABLE IF NOT EXISTS course_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    status assignment_status NOT NULL DEFAULT 'not_started',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(course_id, worker_id)
);

-- Course completions table
CREATE TABLE IF NOT EXISTS course_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID REFERENCES course_assignments(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    quiz_score INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    acknowledgment_signature TEXT NOT NULL,
    acknowledgment_date TIMESTAMP WITH TIME ZONE NOT NULL,
    certificate_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin confirmations table
CREATE TABLE IF NOT EXISTS admin_confirmations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    completion_id UUID UNIQUE REFERENCES course_completions(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    confirmed BOOLEAN NOT NULL,
    reason TEXT,
    notes TEXT,
    confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Retraining logs table
CREATE TABLE IF NOT EXISTS retraining_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    triggered_by UUID REFERENCES users(id),
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_policies_organization ON policies(organization_id);
CREATE INDEX IF NOT EXISTS idx_courses_organization ON courses(organization_id);
CREATE INDEX IF NOT EXISTS idx_courses_policy ON courses(policy_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_course ON quiz_questions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_worker ON course_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_course ON course_assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_course_assignments_status ON course_assignments(status);
CREATE INDEX IF NOT EXISTS idx_course_completions_worker ON course_completions(worker_id);
CREATE INDEX IF NOT EXISTS idx_course_completions_course ON course_completions(course_id);
CREATE INDEX IF NOT EXISTS idx_admin_confirmations_admin ON admin_confirmations(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- ============================================================================
-- HELPER FUNCTIONS (to avoid RLS recursion)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_auth_user_organization_id()
RETURNS UUID AS $$
BEGIN
    RETURN (SELECT organization_id FROM users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() 
        AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE retraining_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Organizations
CREATE POLICY "Users can view their own organization"
    ON organizations FOR SELECT
    USING (id = get_auth_user_organization_id());

-- Users
CREATE POLICY "Users can view users in their organization"
    ON users FOR SELECT
    USING (organization_id = get_auth_user_organization_id());

CREATE POLICY "Admins can insert users in their organization"
    ON users FOR INSERT
    WITH CHECK (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );

CREATE POLICY "Admins can update users in their organization"
    ON users FOR UPDATE
    USING (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );

-- Policies
CREATE POLICY "Users can view policies in their organization"
    ON policies FOR SELECT
    USING (organization_id = get_auth_user_organization_id());

CREATE POLICY "Admins can manage policies"
    ON policies FOR ALL
    USING (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );

-- Courses
CREATE POLICY "Users can view courses in their organization"
    ON courses FOR SELECT
    USING (organization_id = get_auth_user_organization_id());

CREATE POLICY "Admins can manage courses"
    ON courses FOR ALL
    USING (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );

-- Course Assignments
CREATE POLICY "Workers can view their own assignments"
    ON course_assignments FOR SELECT
    USING (worker_id = auth.uid());

CREATE POLICY "Admins can manage all assignments in their organization"
    ON course_assignments FOR ALL
    USING (
        is_admin() AND 
        course_id IN (
            SELECT id FROM courses 
            WHERE organization_id = get_auth_user_organization_id()
        )
    );

-- Course Completions
CREATE POLICY "Workers can view and create their own completions"
    ON course_completions FOR ALL
    USING (worker_id = auth.uid());

-- Admin Confirmations
CREATE POLICY "Admins can manage all confirmations in their organization"
    ON admin_confirmations FOR ALL
    USING (
        is_admin() AND 
        completion_id IN (
            SELECT id FROM course_completions 
            WHERE worker_id IN (
                SELECT id FROM users 
                WHERE organization_id = get_auth_user_organization_id()
            )
        )
    );

-- ============================================================================
-- AUTH TRIGGER (Auto-create Organization and User on Signup)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    new_org_id UUID;
    org_name TEXT;
    prog_type TEXT;
    user_full_name TEXT;
    user_role user_role;
BEGIN
    -- Extract metadata from the new user
    org_name := new.raw_user_meta_data->>'organization_name';
    prog_type := new.raw_user_meta_data->>'program_type';
    user_full_name := new.raw_user_meta_data->>'full_name';
    
    IF org_name IS NOT NULL THEN
        -- This is a new Organization Signup (Admin)
        INSERT INTO public.organizations (name, program_type)
        VALUES (org_name, COALESCE(prog_type, 'Behavioral Health'))
        RETURNING id INTO new_org_id;
        
        user_role := 'admin';
    ELSIF new.raw_user_meta_data->>'organization_id' IS NOT NULL THEN
        -- This is an invited worker
        new_org_id := (new.raw_user_meta_data->>'organization_id')::UUID;
        user_role := 'worker';
    ELSE
        -- No org info, skip profile creation (email/password change, etc.)
        RETURN new;
    END IF;

    -- Create the User Profile
    INSERT INTO public.users (id, organization_id, email, full_name, role)
    VALUES (
        new.id,
        new_org_id,
        new.email,
        COALESCE(user_full_name, 'New User'),
        user_role
    );

    RETURN new;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error creating user profile: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_policies_updated_at ON policies;
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_course_assignments_updated_at ON course_assignments;
CREATE TRIGGER update_course_assignments_updated_at BEFORE UPDATE ON course_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DONE!
-- ============================================================================
-- You can now sign up at http://localhost:3000/signup
-- The trigger will automatically create your organization and user profile
-- ============================================================================

-- BASE SETUP (COMPLETE_SETUP.sql)
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


-- MIGRATION: 20240523000000_add_failed_status.sql
-- Add 'failed' to assignment_status enum
ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'failed';


-- MIGRATION: 20241219_add_users_delete_policy.sql
-- Add DELETE policy for users table
-- This allows admins to delete users in their organization

CREATE POLICY "Admins can delete users in their organization"
    ON users FOR DELETE
    USING (
        is_admin() AND 
        organization_id = get_auth_user_organization_id()
    );


-- MIGRATION: 20241219_create_auto_login_tokens.sql
-- Create auto_login_tokens table for secure auto-login functionality
-- This allows workers to be automatically logged in from email links

CREATE TABLE IF NOT EXISTS auto_login_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    course_assignment_id UUID REFERENCES course_assignments(id) ON DELETE CASCADE,
    redirect_to TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

-- Create indexes for performance (ignore if they exist)
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_token ON auto_login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_user ON auto_login_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_login_tokens_expires ON auto_login_tokens(expires_at);

-- Enable RLS
ALTER TABLE auto_login_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "Admins can manage auto login tokens" ON auto_login_tokens;
DROP POLICY IF EXISTS "Allow token validation" ON auto_login_tokens;
DROP POLICY IF EXISTS "Allow token cleanup" ON auto_login_tokens;

-- Allow admins to manage all tokens (includes service role)
CREATE POLICY "Admins can manage auto login tokens"
    ON auto_login_tokens FOR ALL
    USING (is_admin() OR auth.role() = 'service_role');

-- Allow system to validate tokens (no user context needed for auto-login)
CREATE POLICY "Allow token validation"
    ON auto_login_tokens FOR SELECT
    USING (true);

-- Allow system to delete used tokens
CREATE POLICY "Allow token cleanup"
    ON auto_login_tokens FOR DELETE
    USING (true);


-- MIGRATION: 20241219_create_course_access_tokens.sql
-- Create course_access_tokens table for tokenized course access
-- This allows workers to access courses directly via secure tokens without login

CREATE TABLE course_access_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    assignment_id UUID NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_course_access_tokens_token ON course_access_tokens(token);
CREATE INDEX idx_course_access_tokens_assignment ON course_access_tokens(assignment_id);
CREATE INDEX idx_course_access_tokens_worker ON course_access_tokens(worker_id);
CREATE INDEX idx_course_access_tokens_expires ON course_access_tokens(expires_at);

-- Enable RLS
ALTER TABLE course_access_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow admins to manage all tokens
CREATE POLICY "Admins can manage course access tokens"
    ON course_access_tokens FOR ALL
    USING (is_admin());

-- Allow workers to view their own tokens (for validation)
CREATE POLICY "Workers can view their own access tokens"
    ON course_access_tokens FOR SELECT
    USING (worker_id = auth.uid());

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_course_access_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_course_access_tokens_updated_at
    BEFORE UPDATE ON course_access_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_course_access_tokens_updated_at();


-- MIGRATION: 20251128000000_add_explanation_to_quiz_questions.sql
ALTER TABLE quiz_questions
ADD COLUMN IF NOT EXISTS explanation TEXT;


-- MIGRATION: 20260123114200_add_audit_metadata.sql
-- Add metadata column to course_completions
ALTER TABLE course_completions
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add metadata column to quiz_attempts (check if exists first to be safe, though code relies on it)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quiz_attempts') THEN
        ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;


-- MIGRATION: 20260123_attestation_badge_system.sql
-- Migration: Attestation and Badge System
-- Created: 2026-01-23
-- Description: Adds tables for attestation templates, signed attestations, badges, and badge acknowledgements

-- ============================================
-- 1. Attestation Templates Table
-- ============================================
-- Stores per-course attestation wording with versioning
CREATE TABLE IF NOT EXISTS attestation_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Training Attestation of Understanding and Compliance',
    body_template TEXT NOT NULL DEFAULT 'I confirm that I personally completed the training titled {Course Title} and that I passed the required knowledge check.

By signing below, I attest that:

I have read, understood, and can follow the requirements taught in this training.

I will apply this training to my work and follow our organization''s policies and procedures related to this topic.

I understand that if I am unsure about any part of this training, I am responsible for asking my supervisor or the compliance team for clarification before acting.

I understand that failure to follow these requirements may lead to corrective action, up to and including termination, in line with organizational policy.

Acknowledgement: My signature confirms this attestation is true and accurate.

Effective date: {Completion Date}',
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id)
);

-- Index for quick lookup by course
CREATE INDEX IF NOT EXISTS idx_attestation_templates_course_id ON attestation_templates(course_id);

-- ============================================
-- 2. Attestations Table (Signed Attestations)
-- ============================================
CREATE TABLE IF NOT EXISTS attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES attestation_templates(id),
    course_id UUID NOT NULL REFERENCES courses(id),
    
    -- Signature data
    full_name_signature TEXT NOT NULL,
    agreed_checkbox BOOLEAN NOT NULL DEFAULT true,
    agreed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Audit metadata
    metadata JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    
    -- Constraints
    UNIQUE(assignment_id) -- One attestation per assignment
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attestations_worker_id ON attestations(worker_id);
CREATE INDEX IF NOT EXISTS idx_attestations_course_id ON attestations(course_id);
CREATE INDEX IF NOT EXISTS idx_attestations_agreed_at ON attestations(agreed_at);

-- ============================================
-- 3. Badges Table (Issued Badges)
-- ============================================
CREATE TABLE IF NOT EXISTS badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES course_assignments(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id),
    attestation_id UUID REFERENCES attestations(id),
    
    -- Badge display data
    badge_id_display TEXT NOT NULL, -- Human-readable badge ID like "BADGE-2026-ABC123"
    
    -- Badge statement template
    statement_template TEXT NOT NULL DEFAULT 'This badge confirms that {Employee Full Name} has:

Completed {Course Title}

Passed the required quiz/knowledge check

Signed an attestation confirming understanding and agreement to follow related policies and procedures

Issued by: {Organization Name}
Issued on: {Issued Date}
Badge ID: {Badge ID}',
    
    -- Issuing information
    issuing_organization TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Verification
    verification_url TEXT,
    
    -- Status
    requires_acknowledgement BOOLEAN NOT NULL DEFAULT false,
    is_acknowledged BOOLEAN NOT NULL DEFAULT false,
    
    -- Audit metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(assignment_id) -- One badge per assignment
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_badges_worker_id ON badges(worker_id);
CREATE INDEX IF NOT EXISTS idx_badges_course_id ON badges(course_id);
CREATE INDEX IF NOT EXISTS idx_badges_badge_id_display ON badges(badge_id_display);
CREATE INDEX IF NOT EXISTS idx_badges_issued_at ON badges(issued_at);

-- ============================================
-- 4. Badge Acknowledgements Table
-- ============================================
CREATE TABLE IF NOT EXISTS badge_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    badge_id UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Acknowledgement data
    full_name_signature TEXT NOT NULL,
    agreed_checkbox BOOLEAN NOT NULL DEFAULT true,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Audit metadata
    metadata JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    
    -- Constraints
    UNIQUE(badge_id) -- One acknowledgement per badge
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_badge_acknowledgements_worker_id ON badge_acknowledgements(worker_id);

-- ============================================
-- 5. Course Settings for Attestation/Badge
-- ============================================
-- Add columns to courses table for attestation/badge requirements
ALTER TABLE courses ADD COLUMN IF NOT EXISTS require_attestation BOOLEAN DEFAULT true;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS require_badge_acknowledgement BOOLEAN DEFAULT false;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS badge_issuing_organization TEXT;

-- ============================================
-- 6. RLS Policies
-- ============================================

-- Enable RLS on all new tables
ALTER TABLE attestation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_acknowledgements ENABLE ROW LEVEL SECURITY;

-- Attestation Templates: Admins can manage, workers can read
CREATE POLICY "Admins can manage attestation templates" ON attestation_templates
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin'))
    );

CREATE POLICY "Workers can view attestation templates" ON attestation_templates
    FOR SELECT USING (true);

-- Attestations: Workers can create their own, admins can view all
CREATE POLICY "Workers can create own attestations" ON attestations
    FOR INSERT WITH CHECK (worker_id = auth.uid());

CREATE POLICY "Workers can view own attestations" ON attestations
    FOR SELECT USING (worker_id = auth.uid());

CREATE POLICY "Admins can view all attestations" ON attestations
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin'))
    );

-- Badges: Workers can view own, admins can manage
CREATE POLICY "Workers can view own badges" ON badges
    FOR SELECT USING (worker_id = auth.uid());

CREATE POLICY "Admins can manage badges" ON badges
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin'))
    );

-- Badge Acknowledgements: Workers can create own, admins can view
CREATE POLICY "Workers can create own badge acknowledgements" ON badge_acknowledgements
    FOR INSERT WITH CHECK (worker_id = auth.uid());

CREATE POLICY "Workers can view own badge acknowledgements" ON badge_acknowledgements
    FOR SELECT USING (worker_id = auth.uid());

CREATE POLICY "Admins can view all badge acknowledgements" ON badge_acknowledgements
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('admin', 'super_admin'))
    );

-- ============================================
-- 7. Helper Function: Generate Badge ID
-- ============================================
CREATE OR REPLACE FUNCTION generate_badge_id()
RETURNS TEXT AS $$
DECLARE
    year_part TEXT;
    random_part TEXT;
BEGIN
    year_part := EXTRACT(YEAR FROM NOW())::TEXT;
    random_part := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    RETURN 'BADGE-' || year_part || '-' || random_part;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Done
-- ============================================


-- MIGRATION: add_category_id_to_policies.sql
-- Add document_category_id to policies table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'document_category_id') THEN
        ALTER TABLE policies ADD COLUMN document_category_id UUID REFERENCES document_categories(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_policies_document_category_id ON policies(document_category_id);

-- Update RLS policies if needed (optional, but good practice)
-- Ensure users can only see policies in their organization (already exists usually, but good to verify)
-- DROP POLICY IF EXISTS "Users can view policies in their organization" ON policies;
-- CREATE POLICY "Users can view policies in their organization" ON policies
--     FOR SELECT USING (auth.uid() IN (
--         SELECT id FROM users WHERE organization_id = policies.organization_id
--     ));


-- MIGRATION: add_document_categories.sql
-- Migration: Add Document Categories System
-- Description: Creates tables for hierarchical document management with types and categories

-- 1. Create document_types table
CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  slug TEXT NOT NULL UNIQUE,
  organization_id UUID,  -- Nullable, no FK constraint to avoid dependency
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create document_categories table
CREATE TABLE IF NOT EXISTS document_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_type_id UUID REFERENCES document_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  is_required BOOLEAN DEFAULT false,
  min_documents INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(document_type_id, slug)
);

-- 3. Update policies table to add category reference
-- NOTE: Uncomment this when you have the policies table created
-- ALTER TABLE policies 
-- ADD COLUMN IF NOT EXISTS document_category_id UUID REFERENCES document_categories(id),
-- ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id),
-- ADD COLUMN IF NOT EXISTS file_size BIGINT,
-- ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- 4. Create category_upload_status table for tracking
CREATE TABLE IF NOT EXISTS category_upload_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
  organization_id UUID,  -- Nullable, no FK constraint
  documents_count INTEGER DEFAULT 0,
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  last_uploaded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(category_id, organization_id)
);

-- 5. Create indexes for better query performance
-- NOTE: Uncomment these when you have the policies table created
-- CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(document_category_id);
-- CREATE INDEX IF NOT EXISTS idx_policies_org_category ON policies(organization_id, document_category_id);
CREATE INDEX IF NOT EXISTS idx_category_status_org ON category_upload_status(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_types_org ON document_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_categories_type ON document_categories(document_type_id);

-- 6-7. Create function and trigger to update category upload status
-- NOTE: Uncomment these when you have the policies table created
/*
CREATE OR REPLACE FUNCTION update_category_upload_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the count and status when a policy is added or removed
  INSERT INTO category_upload_status (category_id, organization_id, documents_count, last_uploaded_at)
  VALUES (
    NEW.document_category_id,
    NEW.organization_id,
    1,
    NEW.created_at
  )
  ON CONFLICT (category_id, organization_id) 
  DO UPDATE SET
    documents_count = category_upload_status.documents_count + 1,
    last_uploaded_at = NEW.created_at,
    status = CASE 
      WHEN category_upload_status.documents_count + 1 >= (
        SELECT min_documents FROM document_categories WHERE id = NEW.document_category_id
      ) THEN 'completed'::TEXT
      ELSE 'in_progress'::TEXT
    END,
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_category_status ON policies;
CREATE TRIGGER trigger_update_category_status
  AFTER INSERT ON policies
  FOR EACH ROW
  WHEN (NEW.document_category_id IS NOT NULL)
  EXECUTE FUNCTION update_category_upload_status();
*/

-- 8. Seed default document types (global, no organization_id)
INSERT INTO document_types (name, description, icon, slug, display_order) VALUES
('Organization & Governance Documents', 'policies, strategic plans, management guides, and executive reports', 'building', 'organization-governance', 1),
('Clinical & Working Documents', 'Patient care protocols, operational procedures, forms, and daily work guides', 'clipboard', 'clinical-working', 2)
ON CONFLICT (slug) DO NOTHING;

-- 9. Seed default categories for Organization & Governance
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Policies and Procedures', 'policies-procedures', 1),
  ('Personnel and Workforce Management', 'personnel-workforce', 2),
  ('Quality Management and Performance Improvement', 'quality-management', 3),
  ('Facility, Health, and Safety', 'facility-health-safety', 4),
  ('Financial and Administrative', 'financial-administrative', 5),
  ('Program-Specific Compliance', 'program-compliance', 6)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'organization-governance'
ON CONFLICT (document_type_id, slug) DO NOTHING;

-- 10. Seed default categories for Clinical & Working
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Patient Care Protocols', 'patient-care', 1),
  ('Operational Procedures', 'operational-procedures', 2),
  ('Forms and Templates', 'forms-templates', 3),
  ('Daily Work Guides', 'daily-work-guides', 4)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'clinical-working'
ON CONFLICT (document_type_id, slug) DO NOTHING;

COMMENT ON TABLE document_types IS 'Main document type categories (e.g., Organization & Governance)';
COMMENT ON TABLE document_categories IS 'Subcategories within document types for organizing uploads';
COMMENT ON TABLE category_upload_status IS 'Tracks upload completion status per category per organization';


-- MIGRATION: add_missing_policies_columns.sql
-- Add missing columns to policies table
DO $$
BEGIN
    -- Add file_size
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'file_size') THEN
        ALTER TABLE policies ADD COLUMN file_size BIGINT;
    END IF;

    -- Add mime_type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'mime_type') THEN
        ALTER TABLE policies ADD COLUMN mime_type TEXT;
    END IF;

    -- Add uploaded_by
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'policies' AND column_name = 'uploaded_by') THEN
        ALTER TABLE policies ADD COLUMN uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;


-- MIGRATION: add_must_change_password.sql

-- Add must_change_password column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Update existing workers to NOT require password change (optional, helps migration)
UPDATE public.users 
SET must_change_password = false 
WHERE must_change_password IS NULL;


-- MIGRATION: add_profile_photo_column.sql
-- Migration: Add profile_photo_url column to users table
-- Run this in your Supabase SQL editor

-- Add profile_photo_url column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Add phone_number column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Create storage bucket for profile photos
-- Note: Run the bucket creation in Storage section of Supabase dashboard
-- OR use the following SQL (requires proper permissions):

-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('profile-photos', 'profile-photos', true)
-- ON CONFLICT (id) DO NOTHING;

-- Storage policy to allow authenticated users to upload their own photos
-- Run in SQL Editor:
/*
CREATE POLICY "Users can upload their own profile photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'profile-photos' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own profile photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'profile-photos' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Profile photos are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-photos');
*/


-- MIGRATION: complete_policies_setup.sql
-- Migration: Complete Policies Table Setup
-- Description: Ensures policies table exists and adds document management columns

-- 1. Create policies table if it doesn't exist (from COMPLETE_SETUP.sql)
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID, -- Nullable to avoid dependency issues during setup
    title TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- Changed to TEXT to avoid enum dependency
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add new columns for document management
ALTER TABLE policies 
ADD COLUMN IF NOT EXISTS document_category_id UUID REFERENCES document_categories(id),
ADD COLUMN IF NOT EXISTS uploaded_by UUID, -- Nullable, no FK constraint to users table
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(document_category_id);
CREATE INDEX IF NOT EXISTS idx_policies_org_category ON policies(organization_id, document_category_id);

-- 4. Create function to update category upload status
CREATE OR REPLACE FUNCTION update_category_upload_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the count and status when a policy is added or removed
  INSERT INTO category_upload_status (category_id, organization_id, documents_count, last_uploaded_at)
  VALUES (
    NEW.document_category_id,
    NEW.organization_id,
    1,
    NEW.created_at
  )
  ON CONFLICT (category_id, organization_id) 
  DO UPDATE SET
    documents_count = category_upload_status.documents_count + 1,
    last_uploaded_at = NEW.created_at,
    status = CASE 
      WHEN category_upload_status.documents_count + 1 >= (
        SELECT min_documents FROM document_categories WHERE id = NEW.document_category_id
      ) THEN 'completed'::TEXT
      ELSE 'in_progress'::TEXT
    END,
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger for automatic status updates
DROP TRIGGER IF EXISTS trigger_update_category_status ON policies;
CREATE TRIGGER trigger_update_category_status
  AFTER INSERT ON policies
  FOR EACH ROW
  WHEN (NEW.document_category_id IS NOT NULL)
  EXECUTE FUNCTION update_category_upload_status();


-- MIGRATION: fix_document_types_error.sql
-- Fix for missing document_types table and RLS policies

-- 1. Create tables if they don't exist
CREATE TABLE IF NOT EXISTS document_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  slug TEXT NOT NULL UNIQUE,
  organization_id UUID,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_type_id UUID REFERENCES document_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  is_required BOOLEAN DEFAULT false,
  min_documents INTEGER DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(document_type_id, slug)
);

-- 2. Enable RLS
ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;

-- 3. Add Policies (Allow read for authenticated users)
DROP POLICY IF EXISTS "Allow read access for authenticated users" ON document_types;
CREATE POLICY "Allow read access for authenticated users" ON document_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read access for authenticated users" ON document_categories;
CREATE POLICY "Allow read access for authenticated users" ON document_categories
  FOR SELECT TO authenticated USING (true);

-- 4. Seed Data (if missing)
INSERT INTO document_types (name, description, icon, slug, display_order) VALUES
('Organization & Governance Documents', 'policies, strategic plans, management guides, and executive reports', 'building', 'organization-governance', 1),
('Clinical & Working Documents', 'Patient care protocols, operational procedures, forms, and daily work guides', 'clipboard', 'clinical-working', 2)
ON CONFLICT (slug) DO NOTHING;

-- 5. Seed default categories for Organization & Governance
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Policies and Procedures', 'policies-procedures', 1),
  ('Personnel and Workforce Management', 'personnel-workforce', 2),
  ('Quality Management and Performance Improvement', 'quality-management', 3),
  ('Facility, Health, and Safety', 'facility-health-safety', 4),
  ('Financial and Administrative', 'financial-administrative', 5),
  ('Program-Specific Compliance', 'program-compliance', 6)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'organization-governance'
ON CONFLICT (document_type_id, slug) DO NOTHING;

-- 6. Seed default categories for Clinical & Working
INSERT INTO document_categories (document_type_id, name, description, slug, is_required, min_documents, display_order)
SELECT 
  dt.id,
  categories.name,
  '',
  categories.slug,
  true,
  1,
  categories.display_order
FROM document_types dt
CROSS JOIN (VALUES
  ('Patient Care Protocols', 'patient-care', 1),
  ('Operational Procedures', 'operational-procedures', 2),
  ('Forms and Templates', 'forms-templates', 3),
  ('Daily Work Guides', 'daily-work-guides', 4)
) AS categories(name, slug, display_order)
WHERE dt.slug = 'clinical-working'
ON CONFLICT (document_type_id, slug) DO NOTHING;


-- MIGRATION: worker_training_enhancements.sql
-- Add explanation field to quiz_questions table
ALTER TABLE quiz_questions 
ADD COLUMN IF NOT EXISTS explanation TEXT;

-- Add quiz time limit to courses table
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS quiz_time_limit_minutes INTEGER DEFAULT 30;

-- Create lesson progress tracking table
CREATE TABLE IF NOT EXISTS lesson_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID REFERENCES course_assignments(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sections_viewed TEXT[] DEFAULT '{}',
  last_section TEXT,
  progress_percentage INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, worker_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_lesson_progress_assignment ON lesson_progress(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_worker ON lesson_progress(worker_id);

-- Add updated_at trigger for lesson_progress
CREATE OR REPLACE FUNCTION update_lesson_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_lesson_progress_updated_at ON lesson_progress;
CREATE TRIGGER trigger_update_lesson_progress_updated_at
    BEFORE UPDATE ON lesson_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_lesson_progress_updated_at();


-- SCRIPT FIX: FIX-RLS-policies.sql
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


-- SCRIPT FIX: add-course-version.sql
-- Add version field to courses table for tracking content versions
-- This enables tracking which version of course content a worker completed

ALTER TABLE courses ADD COLUMN IF NOT EXISTS version TEXT DEFAULT '1.0';

-- Create index for efficient version queries
CREATE INDEX IF NOT EXISTS idx_courses_version ON courses(version);

-- Add comment for documentation
COMMENT ON COLUMN courses.version IS 'Version number of course content for tracking changes and compliance';


-- SCRIPT FIX: add-job-title-column.sql
-- Add job_title column to users table to store the CARF Role (e.g. "Direct Care Staff")
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS job_title text;


-- SCRIPT FIX: add-status-column.sql
-- Add status column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended'));

-- Update existing users to have 'active' status if null
UPDATE users SET status = 'active' WHERE status IS NULL;



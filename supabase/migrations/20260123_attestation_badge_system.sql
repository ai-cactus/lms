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

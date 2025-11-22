-- Create organization_settings table
CREATE TABLE IF NOT EXISTS organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    weekly_report_enabled BOOLEAN DEFAULT false,
    monthly_report_enabled BOOLEAN DEFAULT false,
    additional_recipients TEXT[] DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Enable RLS
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can view their org settings"
    ON organization_settings
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM users
            WHERE auth.uid() = id AND (role = 'admin' OR role = 'supervisor')
        )
    );

CREATE POLICY "Admins can update their org settings"
    ON organization_settings
    FOR UPDATE
    USING (
        organization_id IN (
            SELECT organization_id FROM users
            WHERE auth.uid() = id AND (role = 'admin' OR role = 'supervisor')
        )
    );

CREATE POLICY "Admins can insert their org settings"
    ON organization_settings
    FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM users
            WHERE auth.uid() = id AND (role = 'admin' OR role = 'supervisor')
        )
    );

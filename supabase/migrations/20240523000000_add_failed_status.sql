-- Add 'failed' to assignment_status enum
ALTER TYPE assignment_status ADD VALUE IF NOT EXISTS 'failed';

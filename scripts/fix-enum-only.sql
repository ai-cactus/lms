-- 1. Fix missing enum value
-- RUN THIS SCRIPT ALONE FIRST.
-- This command cannot be part of a transaction block where the new value is used.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor';

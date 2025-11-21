# Bug Fix: Database Table Name Mismatch

## Issue
Worker dashboard was throwing empty errors (`{}`) when loading because it was querying a non-existent table.

## Error Message
```
Error loading dashboard: {}
Error details: {}
```

## Root Cause
The code was referencing `supervisor_confirmations` table, but the actual database table is named `admin_confirmations`.

## Files Fixed

### 1. `src/app/worker/dashboard/page.tsx`
**Changes:**
- Line 132: Changed `supervisor_confirmations` → `admin_confirmations`
- Line 32: Updated TypeScript interface `supervisor_confirmation` → `admin_confirmation`
- Line 379: Updated variable reference `supervisor_confirmation` → `admin_confirmation`

### 2. `src/app/admin/dashboard/page.tsx`
**Changes:**
- Line 100: Changed `supervisor_confirmations.id` → `admin_confirmations.id`

## Database Schema Reference
From `supabase/COMPLETE_SETUP.sql`:
```sql
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
```

## Testing
After this fix:
1. ✅ Worker dashboard loads without errors
2. ✅ Completed trainings show correct confirmation status  
3. ✅ Admin dashboard pending confirmations count works correctly

## Status
🟢 **FIXED** - All table references now match the database schema

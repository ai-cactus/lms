# ✅ FINAL SOLUTION: Create Test Users

## The Problem
The email addresses `admin@test.com` and `worker@test.com` already exist in your database from previous failed attempts. The error "Database error checking email" happens because Supabase can't check if they exist due to database issues.

## The Solution: 3 Simple Steps

### Step 1: Complete Cleanup
Run this in [Supabase SQL Editor](https://app.supabase.com/project/iohrsbiubxgzgjcneble/sql):

```sql
-- Delete test users from auth.users (this was missing before!)
DELETE FROM auth.users 
WHERE email IN ('admin@test.com', 'worker@test.com');

-- Delete from public tables
DELETE FROM public.users 
WHERE email IN ('admin@test.com', 'worker@test.com');

DELETE FROM public.organizations 
WHERE name = 'Test Organization';

-- Disable trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create fresh organization
INSERT INTO public.organizations (id, name, program_type, license_number)
VALUES (
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'Test Organization',
    'Behavioral Health',
    'TEST-12345'
);

SELECT '✅ Ready for Step 2!' as status;
```

### Step 2: Create Users
Run this command:

```bash
node scripts/create-users-no-trigger.js
```

You should see:
```
✅ Admin created: [uuid]
✅ Worker created: [uuid]
✅ Profiles created
🎉 SUCCESS!
```

### Step 3: Re-enable Trigger (Optional)
Run this in Supabase SQL Editor:

```sql
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## Login Credentials

- **Admin**: admin@test.com / Admin123!
- **Worker**: worker@test.com / Worker123!

Test at: http://localhost:3000/login

---

## If It Still Fails

The script will fail if email addresses already exist in `auth.users`. If you see "Database error checking email" again:

1. Go to [Supabase Dashboard > Authentication > Users](https://app.supabase.com/project/iohrsbiubxgzgjcneble/auth/users)
2. Manually delete any users with @test.com emails
3. Run Step 1 SQL again
4. Try Step 2 again

---

## Files

- `scripts/CLEANUP-test-users.sql` - Full cleanup SQL
- `scripts/STEP1-disable-trigger.sql` - Disable trigger + create org
- `scripts/create-users-no-trigger.js` - Create users
- `scripts/diagnose.js` - Diagnostics (if needed)

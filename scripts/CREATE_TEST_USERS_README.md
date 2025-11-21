# 🛠️ SIMPLIFIED: Create Test Users (Bypass Trigger Issues)

The auth trigger is causing database errors. This guide shows you how to **bypass it completely** and create test users manually.

## 🎯 Quick Steps

### Method 1: Automated (Recommended) ⚡

1. **Disable trigger & create org** - Run in [Supabase SQL Editor](https://app.supabase.com/project/iohrsbiubxgzgjcneble/sql):
   ```sql
   -- Disable trigger
   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
   
   -- Clean up
   DELETE FROM public.users WHERE email IN ('admin@test.com', 'worker@test.com');
   DELETE FROM public.organizations WHERE name = 'Test Organization';
   
   -- Create organization
   INSERT INTO public.organizations (id, name, program_type, license_number)
   VALUES (
       'a0000000-0000-0000-0000-000000000001',
       'Test Organization',
       'Behavioral Health',
       'TEST-12345'
   );
   ```

2. **Create users** - Run this command:
   ```bash
   node scripts/create-users-no-trigger.js
   ```

3. **Re-enable trigger** - Run in Supabase SQL Editor:
   ```sql
   CREATE TRIGGER on_auth_user_created
       AFTER INSERT ON auth.users
       FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
   ```

4. **Done!** Login with:
   - Admin: `admin@test.com` / `Admin123!`
   - Worker: `worker@test.com` / `Worker123!`

---

### Method 2: Manual (If Node.js fails) 📝

1. **Run step 1 from Method 1** (disable trigger & create org)

2. **Create users in Supabase Dashboard**:
   - Go to [Authentication > Users](https://app.supabase.com/project/iohrsbiubxgzgjcneble/auth/users)
   - Click "Add User" or "Invite User"
   - Create admin:
     - Email: `admin@test.com`
     - Password: `Admin123!`
     - Auto-confirm: ✅ YES
   - Create worker:
     - Email: `worker@test.com`
     - Password: `Worker123!`
     - Auto-confirm: ✅ YES
   - **Copy both user UUIDs** (you'll need them next)

3. **Create user profiles** - Run in Supabase SQL Editor:
   ```sql
   -- Replace YOUR-ADMIN-UUID and YOUR-WORKER-UUID with actual UUIDs from step 2
   INSERT INTO public.users (id, organization_id, email, full_name, role)
   VALUES 
       (
           'YOUR-ADMIN-UUID-HERE'::uuid,
           'a0000000-0000-0000-0000-000000000001',
           'admin@test.com',
           'Test Admin User',
           'admin'
       ),
       (
           'YOUR-WORKER-UUID-HERE'::uuid,
           'a0000000-0000-0000-0000-000000000001',
           'worker@test.com',
           'Test Worker User',
           'worker'
       );
   ```

4. **Re-enable trigger** (same as Method 1 step 3)

---

## ✅ Verify It Worked

Run this in Supabase SQL Editor:

```sql
-- Should show 1 organization
SELECT * FROM public.organizations WHERE name = 'Test Organization';

-- Should show 2 users
SELECT id, email, full_name, role 
FROM public.users 
WHERE organization_id = 'a0000000-0000-0000-0000-000000000001';
```

Expected output:
- 1 organization: "Test Organization"
- 2 users: admin@test.com (admin), worker@test.com (worker)

---

## 🧪 Test Login

1. Go to http://localhost:3000/login
2. Try admin credentials: `admin@test.com` / `Admin123!`
3. Logout
4. Try worker credentials: `worker@test.com` / `Worker123!`

---

## 🐛 Troubleshooting

### "Database error checking email" when running Node.js script
- The trigger wasn't disabled. Run the SQL from Method 1 Step 1 first.

### "constraint violation" or "duplicate key"
- Test users already exist. Run the DELETE statements from Method 1 Step 1.

### Can't login after creating users
- Make sure you set "Auto-confirm" to YES when creating in Dashboard
- OR run this SQL to confirm them:
  ```sql
  UPDATE auth.users 
  SET email_confirmed_at = NOW() 
  WHERE email IN ('admin@test.com', 'worker@test.com');
  ```

### Profile not found after login
- User profiles weren't created. Run step 3 from Method 2.

---

## 🎓 Understanding the Issue

The auth trigger (`handle_new_user`) is supposed to automatically create:
1. Organizations (for admin signups)
2. User profiles (for all signups)

But it's failing due to a database error. By temporarily disabling it, we can:
- Create auth users normally
- Manually create the org and profiles
- Re-enable the trigger for future signups

---

## 📚 Files Reference

- `scripts/create-users-no-trigger.js` - Automated user creation (Method 1)
- `scripts/create-users-direct.sql` - Full SQL with instructions (Method 2)
- `scripts/check-db.js` - Check current database state

---

## 🔄 What About Future Signups?

After re-enabling the trigger, future signups through your app should work normally. If they don't, you may need to:
1. Fix the root cause of the trigger error
2. Check Supabase logs for specific error details
3. Review RLS policies
4. Consider a different approach to user provisioning

For now, these test users will let you test your app's post-login functionality!

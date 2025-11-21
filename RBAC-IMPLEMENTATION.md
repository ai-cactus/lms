# Role-Based Access Control (RBAC) - Implementation Summary

## What Was Fixed

Added role-based access control to both admin and worker dashboards to prevent users from accessing routes they shouldn't have access to.

## Changes Made

### 1. Worker Dashboard (`/worker/dashboard`)
**File**: `src/app/worker/dashboard/page.tsx`

**What it does now**:
- ✅ Checks user role before loading data
- ✅ Redirects admins to `/admin/dashboard`
- ✅ Only allows users with `role = 'worker'` to proceed
- ✅ Better error logging with details

**Code added**:
```typescript
// Get worker profile and check role
const { data: workerData, error: profileError } = await supabase
    .from("users")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

// Redirect admins to their dashboard
if (workerData.role === "admin") {
    console.log("Admin user accessing worker dashboard - redirecting");
    router.push("/admin/dashboard");
    return;
}

// Ensure user is actually a worker
if (workerData.role !== "worker") {
    console.error("User role is not worker:", workerData.role);
    router.push("/login");
    return;
}
```

### 2. Admin Dashboard (`/admin/dashboard`)
**File**: `src/app/admin/dashboard/page.tsx`

**What it does now**:
- ✅ Checks user role before loading data
- ✅ Redirects workers to `/worker/dashboard`
- ✅ Only allows users with `role = 'admin'` to proceed

**Code added**:
```typescript
// Get user's organization and role
const { data: userData, error: profileError } = await supabase
    .from("users")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

// Redirect workers to their dashboard
if (userData.role === "worker") {
    console.log("Worker user accessing admin dashboard - redirecting");
    router.push("/worker/dashboard");
    return;
}

// Ensure user is actually an admin
if (userData.role !== "admin") {
    console.error("User role is not admin:", userData.role);
    router.push("/login");
    return;
}
```

## Testing

### Test 1: Admin accessing worker route
1. Login as: `admin@test.com` / `Admin123!`
2. Navigate to: http://localhost:3000/worker/dashboard
3. **Expected**: Automatically redirected to `/admin/dashboard`
4. **Console**: "Admin user accessing worker dashboard - redirecting"

### Test 2: Worker accessing admin route
1. Login as: `worker@test.com` / `Worker123!`
2. Navigate to: http://localhost:3000/admin/dashboard
3. **Expected**: Automatically redirected to `/worker/dashboard`
4. **Console**: "Worker user accessing admin dashboard - redirecting"

### Test 3: Proper access
1. Admin at `/admin/dashboard` ✅
2. Worker at `/worker/dashboard` ✅

## Error Handling Improvements

Added detailed error logging:
```typescript
catch (error: any) {
    console.error("Error loading dashboard:", error);
    console.error("Error details:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
    });
    setLoading(false);
}
```

This will help debug future issues by showing:
- Error message
- Error code (from Supabase)
- Error details
- Helpful hints

## Routes Summary

| Route | Allowed Role | Redirects |
|-------|-------------|-----------|
| `/admin/dashboard` | Admin only | Workers → `/worker/dashboard` |
| `/worker/dashboard` | Workers only | Admins → `/admin/dashboard` |
| `/login` | Anyone | Based on role after login |
| `/` (home) | Any authenticated | Based on role |

## What Happens Now

When you (as an admin) try to access `/worker/dashboard`:
1. Page loads the user data
2. Checks your role → `admin`
3. Logs: "Admin user accessing worker dashboard - redirecting"
4. Redirects you to `/admin/dashboard`
5. No more empty error `{}`!

The error you saw before was likely because the query for `course_assignments` returned nothing (admins don't have assignments), and the empty error object was being logged.

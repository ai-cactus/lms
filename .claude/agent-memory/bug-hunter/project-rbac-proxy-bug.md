---
name: project-rbac-proxy-bug
description: RBAC migration broke admin-portal login — proxy.ts has requiredRole:'admin' which matches no post-migration role
metadata:
  type: project
---

After the RBAC migration (roles: owner/supervisor/hr/clinical_director/finance/worker), admin-portal login silently bounces users back to /login.

**Root cause:** `src/proxy.ts` line 21 has `requiredRole: 'admin'` in the admin ROUTE_CONFIG. After migration no JWT carries `role:'admin'`, so the check `token.role !== cfg.requiredRole` (line 90) is always true for all admin-portal users. The proxy deletes the cookie and redirects to /login.

**Why:** The proxy was written when 'admin' was the only admin role. The RBAC migration renamed admin→supervisor and added owner/hr/clinical_director/finance but did not update the proxy's requiredRole.

**Confirmed by:** MCP browser session — fill login form as supervisor, click submit, page lands back at /login with cleared form and no error message (clean redirect, not an action error). The proxy's decode succeeds (NextAuth v5 encrypts with AUTH_SECRET env var internally, proxy decodes with same AUTH_SECRET) but the role check fails.

**Worker login unaffected:** worker.session-token has `role:'worker'` which still matches ROUTE_CONFIG.worker.requiredRole:'worker'.

**Fix needed (for code-ninja):** In `src/proxy.ts`, change the admin config's `requiredRole` from a scalar string to a Set/Array check using `ADMIN_ROLES` from `@/lib/rbac/role-utils`. Specifically, the check at line 90 must become `!ADMIN_ROLES.includes(token.role)` instead of `token.role !== cfg.requiredRole`.

**NEXTAUTH_SECRET vs AUTH_SECRET:** .env.local has two different values. create-auth-instance.ts reads NEXTAUTH_SECRET; proxy.ts reads AUTH_SECRET. In practice NextAuth v5 uses AUTH_SECRET internally (ignoring the secret option), so decoding succeeds. The NEXTAUTH_SECRET reference in create-auth-instance.ts is dead code — a separate cleanup candidate but NOT blocking login after the requiredRole fix.

**How to apply:** When writing/running e2e login tests for admin-portal roles (supervisor/owner/hr/etc.), these tests will fail until code-ninja fixes `src/proxy.ts`. The tests themselves are correct.

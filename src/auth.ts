import { createAuthInstance } from '@/lib/create-auth-instance';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';

const adminAuth = createAuthInstance({
  cookiePrefix: 'admin',
  allowedRoles: ADMIN_ROLES,
  basePath: '/api/auth',
});

export const { handlers, auth, signIn, signOut } = adminAuth;
export const adminConfig = adminAuth.options;

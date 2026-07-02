import { createAuthInstance } from '@/lib/create-auth-instance';

const adminAuth = createAuthInstance({
  cookiePrefix: 'admin',
  allowedRoles: ['owner', 'supervisor', 'hr', 'clinical_director', 'finance'],
  basePath: '/api/auth',
});

export const { handlers, auth, signIn, signOut } = adminAuth;
export const adminConfig = adminAuth.options;

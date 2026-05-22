import { createAuthInstance } from '@/lib/create-auth-instance';

const adminAuth = createAuthInstance({
  cookiePrefix: 'admin',
  allowedRole: 'admin',
  basePath: '/api/auth',
});

export const { handlers, auth, signIn, signOut } = adminAuth;
export const adminConfig = adminAuth.options;

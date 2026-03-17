import { createAuthInstance } from '@/lib/create-auth-instance';

export const { handlers, auth, signIn, signOut } = createAuthInstance({
  cookiePrefix: 'admin',
  allowedRole: 'admin',
  basePath: '/api/auth',
});

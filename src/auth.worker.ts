import { createAuthInstance } from '@/lib/create-auth-instance';

export const { handlers, auth, signIn, signOut } = createAuthInstance({
  cookiePrefix: 'worker',
  allowedRole: 'worker',
  basePath: '/api/auth-worker',
});

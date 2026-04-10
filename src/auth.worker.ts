import { createAuthInstance } from '@/lib/create-auth-instance';

const workerAuth = createAuthInstance({
  cookiePrefix: 'worker',
  allowedRole: 'worker',
  basePath: '/api/auth-worker',
});

export const { handlers, auth, signIn, signOut } = workerAuth;
export const workerConfig = workerAuth.options;

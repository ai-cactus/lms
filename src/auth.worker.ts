import { createAuthInstance } from '@/lib/create-auth-instance';
import { WORKER_ROLES } from '@/lib/rbac/role-utils';

const workerAuth = createAuthInstance({
  cookiePrefix: 'worker',
  allowedRoles: WORKER_ROLES,
  basePath: '/api/auth-worker',
});

export const { handlers, auth, signIn, signOut } = workerAuth;
export const workerConfig = workerAuth.options;

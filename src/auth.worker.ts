import { createAuthInstance } from '@/lib/create-auth-instance';
import { ALL_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';

const workerAuth = createAuthInstance({
  cookiePrefix: 'worker',
  allowedRoles: WORKER_ROLES,
  // Admins bridged into learner mode carry their real (admin) role on the worker
  // cookie, so they must survive JWT re-validation here even though they can
  // never log in through the worker login form (that still gates on WORKER_ROLES).
  sessionAllowedRoles: ALL_ROLES,
  basePath: '/api/auth-worker',
});

export const { handlers, auth, signIn, signOut } = workerAuth;
export const workerConfig = workerAuth.options;

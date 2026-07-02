/**
 * Reusable API route guard. Resolves the authenticated admin session, maps the
 * stored DB role to its permission `RoleKey`, and checks a single permission.
 *
 * Usage:
 *   const result = await authorize('billing.read');
 *   if (!result.ok) return result.response;
 *   const { ctx } = result;
 *   if (!ctx.organizationId) return apiError('No organization found', 404);
 */
import type { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { apiError } from '@/lib/api-response';
import { logger, maskEmail } from '@/lib/logger';
import { can, type Permission, type RoleKey } from './permissions';
import { dbRoleToRoleKey } from './role-utils';
import type { Role } from '@/types/next-auth';

export interface AuthorizedContext {
  userId: string;
  email: string;
  role: Role;
  roleKey: RoleKey;
  organizationId: string | null;
}

export type AuthResult =
  | { ok: true; ctx: AuthorizedContext }
  | { ok: false; response: NextResponse };

/**
 * Authorize the current request against a single permission.
 * Returns `{ ok: true, ctx }` on success, or `{ ok: false, response }` carrying
 * a ready-to-return 401/403 error response.
 */
export async function authorize(permission: Permission): Promise<AuthResult> {
  const session = await auth();

  if (!session?.user?.id) {
    return { ok: false, response: apiError('Unauthorized', 401) };
  }

  const role = session.user.role;
  const roleKey = dbRoleToRoleKey(role);

  if (!can(roleKey, permission)) {
    logger.warn({
      msg: '[rbac] Permission denied',
      userId: session.user.id,
      email: maskEmail(session.user.email),
      role,
      permission,
    });
    return { ok: false, response: apiError('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS') };
  }

  return {
    ok: true,
    ctx: {
      userId: session.user.id,
      email: session.user.email,
      role,
      roleKey,
      organizationId: session.user.organizationId,
    },
  };
}

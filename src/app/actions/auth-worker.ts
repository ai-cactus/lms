'use server';

import { signIn } from '@/auth.worker';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { resolveActiveMembership } from '@/lib/auth/membership';
import { AuthError } from 'next-auth';
import prisma from '@/lib/prisma';

export type AuthState = {
  error?: string;
  success?: boolean;
  redirect?: string;
};

export async function authenticateWorker(
  prevState: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  try {
    const email = formData.get('email') as string;
    let redirectTo = '/worker';

    if (email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (user) {
        // Same active-membership resolution the credentials provider uses to
        // gate sign-in — an admin-tier account is redirected to the admin
        // login before the worker form even submits.
        const resolution = await resolveActiveMembership(user.id);
        const activeRole =
          resolution.kind === 'resolved'
            ? resolution.membership.role
            : resolution.kind === 'choice'
              ? resolution.memberships[0].role
              : null;
        if (activeRole && isAdminRole(activeRole)) {
          return { redirect: '/login' };
        }
        // A membership-less identity belongs in join-by-code onboarding. Landing
        // it on /worker would leave the proxy's onboarding gate (src/proxy.ts)
        // to re-route this server action's own navigation, which stalls or
        // crashes the client (Next.js E394) — so route there at the source.
        if (resolution.kind === 'none') {
          redirectTo = '/onboarding-worker';
        }
      }
    }

    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirectTo,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      switch ((error as AuthError).type) {
        case 'CredentialsSignin':
          return { error: 'Invalid worker credentials.' };
        default:
          return { error: 'Something went wrong.' };
      }
    }
    throw error;
  }
}

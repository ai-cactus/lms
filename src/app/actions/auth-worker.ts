'use server';

import { signIn } from '@/auth.worker';
import { AuthError } from 'next-auth';
import { prisma } from '@/lib/prisma';

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
    if (email) {
      const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
      if (user && user.role === 'admin') {
        return { redirect: '/login' };
      }
    }

    await signIn('credentials', {
      ...Object.fromEntries(formData),
      redirectTo: '/worker',
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

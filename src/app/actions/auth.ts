'use server';

import { signIn } from '@/auth';
import { signIn as signInWorker } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@/lib/password-policy';
import { AuthError } from 'next-auth';
import { sendPasswordResetEmail } from '@/lib/email';
import crypto from 'crypto';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Pre-computed dummy hash for constant-time response when a user email doesn't exist.
// bcrypt runs its full ~100ms computation and returns false, preventing timing-based
// username enumeration attacks.
const DUMMY_BCRYPT_HASH = '$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// Define return type
export type AuthState = {
  error?: string;
  success?: boolean;
  redirect?: string;
};

export async function authenticate(
  prevState: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  // Rate limiting — 10 attempts per IP per 15 minutes
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';

  const { allowed } = await checkRateLimit(`login:${ip}`, 10, 900);
  if (!allowed) {
    logger.warn({ msg: 'Auth rate limit exceeded', ip });
    return { error: 'Too many login attempts. Please try again in 15 minutes.' };
  }

  try {
    const email = formData.get('email') as string;
    let role: 'admin' | 'worker' = 'admin';

    // Role lookup with timing equalization — prevents username enumeration via response time.
    // If no user is found, bcrypt still runs on a dummy hash so timing is indistinguishable
    // from a valid login attempt with a wrong password.
    const lookupUser = email
      ? await prisma.user.findUnique({
          where: { email },
          select: { role: true, mfaEnabled: true, id: true },
        })
      : null;

    if (!lookupUser) {
      await bcrypt.compare('dummy', DUMMY_BCRYPT_HASH);
      return { error: 'Invalid credentials.' };
    }

    if (lookupUser.role === 'worker') {
      role = 'worker';
    }

    logger.info({ msg: 'Auth action: routing login', role, mfaEnabled: lookupUser.mfaEnabled });

    // Determine redirect target — if MFA is enabled, go to MFA verify page first
    const mfaRedirect = lookupUser.mfaEnabled
      ? `/mfa/verify?userId=${lookupUser.id}&role=${role}`
      : null;

    if (role === 'worker') {
      await signInWorker('credentials', {
        ...Object.fromEntries(formData),
        redirectTo: mfaRedirect || '/worker',
      });
    } else {
      await signIn('credentials', {
        ...Object.fromEntries(formData),
        redirectTo: mfaRedirect || '/dashboard',
      });
    }

    return { success: true };
  } catch (error: unknown) {
    if (isRedirectError(error)) {
      throw error;
    }

    logger.error({ msg: 'Auth action error', error: String(error) });
    if (error instanceof AuthError) {
      switch ((error as AuthError).type) {
        case 'CredentialsSignin':
          return { error: 'Invalid credentials.' };
        default:
          return { error: 'Something went wrong.' };
      }
    }
    throw error;
  }
}

export type SignupResult = { success: true } | { success: false; error: string };

export async function signup(
  prevState: SignupResult | undefined,
  formData: FormData,
): Promise<SignupResult> {
  // Legacy function - kept for backwards compatibility
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const firstName = formData.get('firstName') as string;
  const lastName = formData.get('lastName') as string;

  return signupWithRole({
    email,
    password,
    firstName,
    lastName,
    role: 'worker', // Default role
  });
}

interface SignupWithRoleData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'worker';
}

export async function signupWithRole(data: SignupWithRoleData): Promise<SignupResult> {
  const { email, password, firstName, lastName, role } = data;

  // Basic validation
  if (!email || !password || !firstName || !lastName || !role) {
    return { success: false, error: 'All fields are required' };
  }

  // Server-side password policy enforcement
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) {
    return {
      success: false,
      error: `Password does not meet requirements: ${pwCheck.errors.join(', ')}`,
    };
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return { success: false, error: 'Account with this email already exists.' };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Clean up any existing verification tokens for this email
    await prisma.verificationToken.deleteMany({
      where: { identifier: email, type: 'email_verification' },
    });

    // Create verification token with pending user data including role (5 minute expiry)
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        type: 'email_verification',
        expires,
        password: hashedPassword,
        firstName,
        lastName,
        role,
      },
    });

    // Send verification email — explicitly check the result so a send failure
    // is surfaced back to the UI rather than silently treated as success.
    const { sendEmailVerification } = await import('@/lib/email');
    const emailResult = await sendEmailVerification(email, token);

    if (!emailResult.success) {
      // Clean up the token we created — user will need to retry and a fresh token
      // will be generated, preventing stale-token confusion.
      await prisma.verificationToken.deleteMany({
        where: { identifier: email, type: 'email_verification' },
      });
      logger.error({ msg: 'Verification email failed to send', identifier: email });
      return {
        success: false,
        error:
          'We could not send a verification email. Please check your email address and try again.',
      };
    }

    return { success: true };
  } catch (error: unknown) {
    logger.error({ msg: 'Signup error', err: String(error) });
    return { success: false, error: 'Failed to create account. Please try again.' };
  }
}

export async function sendPasswordResetLink(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { success: true }; // Security: Don't reveal user existence
  }

  // Generate secure UUID token
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Clean up old tokens for this user first
  await prisma.verificationToken.deleteMany({
    where: { identifier: email },
  });

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires,
    },
  });

  const emailResult = await sendPasswordResetEmail(email, token);
  if (!emailResult.success) {
    return { success: false, error: 'Failed to send email.' };
  }

  return { success: true };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<AuthState> {
  // Server-side password policy enforcement
  const pwCheck = validatePassword(newPassword);
  if (!pwCheck.valid) {
    return { error: `Password does not meet requirements: ${pwCheck.errors.join(', ')}` };
  }

  const verificationToken = await prisma.verificationToken.findFirst({
    where: {
      token, // Token is unique enough, but we should verify against user email if we had it in context,
      // but here the token proves possession of the link.
      expires: { gt: new Date() },
    },
  });

  if (!verificationToken) {
    return { error: 'Invalid or expired reset link.' };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { email: verificationToken.identifier },
    data: { password: hashedPassword },
  });

  // delete used token
  await prisma.verificationToken.delete({
    where: {
      identifier_token: {
        identifier: verificationToken.identifier,
        token: verificationToken.token,
      },
    },
  });

  return { success: true };
}

export async function forceResetPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthState> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    return { error: 'Invalid credentials.' };
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    return { error: 'Invalid current password.' };
  }

  const pwCheck = validatePassword(newPassword);
  if (!pwCheck.valid) {
    return { error: `Password does not meet requirements: ${pwCheck.errors.join(', ')}` };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { email },
    data: { password: hashedPassword, passwordResetRequired: false },
  });

  return { success: true };
}

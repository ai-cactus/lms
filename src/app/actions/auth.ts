'use server';

import { signIn } from '@/auth';
import { signIn as signInWorker } from '@/auth.worker';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validatePassword } from '@/lib/password-policy';
import { AuthError } from 'next-auth';
import { sendPasswordResetEmail } from '@/lib/email';
import crypto from 'crypto';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/rate-limit';
import { EMAIL_VERIFICATION_EXPIRY_MS } from '@/lib/auth-constants';
import { logger, maskEmail } from '@/lib/logger';
import { createMfaChallenge } from '@/lib/mfa-challenge';

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

      // A signup that hasn't verified its email exists only as a live
      // email_verification token (no User row yet). Surface an actionable hint
      // so the user isn't stuck on a generic "Invalid credentials." message.
      if (email) {
        const pendingVerification = await prisma.verificationToken.findFirst({
          where: {
            identifier: email,
            type: 'email_verification',
            expires: { gt: new Date() },
          },
          select: { identifier: true },
        });
        if (pendingVerification) {
          return { error: 'Please verify your email to sign in.' };
        }
      }

      return { error: 'Invalid credentials.' };
    }

    if (lookupUser.role === 'worker') {
      role = 'worker';
    }

    logger.info({
      msg: 'Auth action: routing login',
      role,
      mfaEnabled: lookupUser.mfaEnabled,
      email: maskEmail(email),
    });

    // Determine redirect target — if MFA is enabled, create a challenge token
    // and redirect to the MFA verify page with the opaque token (no userId in URL)
    let mfaRedirect: string | null = null;
    if (lookupUser.mfaEnabled) {
      const challengeToken = await createMfaChallenge(lookupUser.id, role);
      mfaRedirect = `/mfa/verify?challenge=${challengeToken}`;
    }

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

  // Rate limiting — 5 attempts per IP per 10 minutes. Runs before any DB access
  // (existence check, token creation) and before any email send.
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  const { allowed } = await checkRateLimit(`signup:${ip}`, 5, 600);
  if (!allowed) {
    logger.warn({ msg: '[auth] Signup rate limit exceeded', ip });
    return { success: false, error: 'Too many signup attempts. Please try again later.' };
  }

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

    // Create verification token with pending user data including role (24 hour expiry)
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

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
    logger.info({
      msg: '[auth] Password reset requested: email not found (no-op for security)',
      email: maskEmail(email),
    });
    return { success: true }; // Security: Don't reveal user existence
  }

  // Generate secure UUID token
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Clean up old password-reset tokens for this user first (leave any pending
  // email-verification tokens intact).
  await prisma.verificationToken.deleteMany({
    where: { identifier: email, type: 'password_reset' },
  });

  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      type: 'password_reset',
      expires,
    },
  });

  const emailResult = await sendPasswordResetEmail(email, token);
  if (!emailResult.success) {
    logger.error({ msg: '[auth] Password reset email failed to send', email: maskEmail(email) });
    return { success: false, error: 'Failed to send email.' };
  }

  logger.info({ msg: '[auth] Password reset email sent', email: maskEmail(email) });
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
      token,
      // Scope strictly to password-reset tokens so a token minted for another
      // purpose (e.g. email verification) cannot be redeemed here.
      type: 'password_reset',
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

  logger.info({
    msg: '[auth] Password reset completed',
    email: maskEmail(verificationToken.identifier),
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

  logger.info({ msg: '[auth] Forced password reset completed', email: maskEmail(email) });
  return { success: true };
}

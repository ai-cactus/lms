'use server';

import { signIn, auth as adminAuth } from '@/auth';
import { signIn as signInWorker, auth as workerAuth } from '@/auth.worker';
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
import { isWorkerRole } from '@/lib/rbac/role-utils';
import { verifyCaptcha } from '@/lib/captcha';
import { audit, getClientContext } from '@/lib/audit';
import { BCRYPT_COST } from '@/lib/bcrypt-config';

// Pre-computed dummy hash for constant-time response when a user email doesn't exist.
// bcrypt runs its full computation and returns false, preventing timing-based
// username enumeration attacks. The cost factor MUST match BCRYPT_COST so the
// dummy compare takes the same time as a real login (F-058).
const DUMMY_BCRYPT_HASH = '$2b$12$WcSFYgX/PiZHV/21.0M2fuVfQ23xb6TQloNTnuIk9twRudyN/T8cW';

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

  // F-024: auth-critical — fail closed if Redis is down.
  const { allowed } = await checkRateLimit(`login:${ip}`, 10, 900, { failClosed: true });
  if (!allowed) {
    logger.warn({ msg: 'Auth rate limit exceeded', ip });
    await audit({
      action: 'auth.login.failure',
      ...getClientContext(headersList),
      metadata: { reason: 'rate_limited', layer: 'action' },
    });
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

    if (isWorkerRole(lookupUser.role)) {
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

interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Optional hCaptcha token; verified only when the feature is enabled (inert otherwise). */
  captchaToken?: string;
}

export async function signup(data: SignupData): Promise<SignupResult> {
  const { email, password, firstName, lastName, captchaToken } = data;

  // Rate limiting — 5 attempts per IP per 10 minutes. Runs before any DB access
  // (existence check, token creation) and before any email send.
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  // F-024: auth-critical — fail closed if Redis is down.
  const { allowed } = await checkRateLimit(`signup:${ip}`, 5, 600, { failClosed: true });
  if (!allowed) {
    logger.warn({ msg: '[auth] Signup rate limit exceeded', ip });
    return { success: false, error: 'Too many signup attempts. Please try again later.' };
  }

  // Bot verification — no-op unless hCaptcha is enabled (see src/lib/captcha.ts).
  const captchaValid = await verifyCaptcha(captchaToken, ip);
  if (!captchaValid) {
    logger.warn({ msg: '[auth] Signup captcha verification failed', ip });
    return { success: false, error: 'Captcha verification failed. Please try again.' };
  }

  if (!email || !password || !firstName || !lastName) {
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
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return { success: false, error: 'Account with this email already exists.' };
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

    await prisma.verificationToken.deleteMany({
      where: { identifier: email, type: 'email_verification' },
    });

    // Create verification token with pending user data including role (24 hour expiry).
    // Self-serve signup always founds an organisation, so the account becomes an `owner`.
    // Worker accounts are created only via invites (join/[token] flow), never here.
    const persistedRole = 'owner';
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
        role: persistedRole,
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

    // F-001: signup initiated (no User row exists yet — only a verification token).
    await audit({
      action: 'auth.signup',
      ...getClientContext(headersList),
      metadata: { role: persistedRole, email: maskEmail(email), pendingVerification: true },
    });

    return { success: true };
  } catch (error: unknown) {
    logger.error({ msg: 'Signup error', err: String(error) });
    return { success: false, error: 'Failed to create account. Please try again.' };
  }
}

export async function sendPasswordResetLink(email: string) {
  // F-037: throttle reset requests per-IP — 5 attempts per 10 minutes. Runs
  // before any DB access or email send. On limit we return the same no-op
  // success shape used for a non-existent email, so an attacker can't tell
  // whether they were throttled, and existence is never leaked.
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    'unknown';
  // F-024: auth-critical — fail closed if Redis is down.
  const { allowed } = await checkRateLimit(`password-reset:${ip}`, 5, 600, { failClosed: true });
  if (!allowed) {
    logger.warn({ msg: '[auth] Password reset request rate limit exceeded', ip });
    return { success: true }; // Security: don't reveal throttling or user existence
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    logger.info({
      msg: '[auth] Password reset requested: email not found (no-op for security)',
      email: maskEmail(email),
    });
    return { success: true }; // Security: Don't reveal user existence
  }

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
  // F-001: password reset requested (email dispatched to a real account).
  await audit({
    action: 'auth.password.reset_request',
    actorId: user.id,
    actorRole: user.role,
    organizationId: user.organizationId ?? undefined,
    ...getClientContext(headersList),
    metadata: { email: maskEmail(email) },
  });
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

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_COST);

  // F-059: bump sessionVersion so completing the reset invalidates every other
  // existing session (the jwt callback compares the token's version on decode).
  const updatedUser = await prisma.user.update({
    where: { email: verificationToken.identifier },
    data: { password: hashedPassword, sessionVersion: { increment: 1 } },
    select: { id: true, role: true, organizationId: true },
  });

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
  // F-001: password reset completed via emailed token.
  await audit({
    action: 'auth.password.reset',
    actorId: updatedUser.id,
    actorRole: updatedUser.role,
    organizationId: updatedUser.organizationId ?? undefined,
    ...getClientContext(await headers()),
    metadata: { email: maskEmail(verificationToken.identifier), method: 'token' },
  });
  return { success: true };
}

export async function forceResetPassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthState> {
  // Derive the account from the authenticated session, not from the URL/caller
  // (F-057): the forced-reset flow is only reachable while signed in, so the
  // email no longer needs to travel in the redirect query string.
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  const email = admin?.user?.email ?? worker?.user?.email;
  if (!email) {
    return { error: 'Not authenticated.' };
  }

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

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_COST);

  // F-059: bump sessionVersion so the forced reset also logs out every other
  // existing session (the jwt callback compares the token's version on decode).
  await prisma.user.update({
    where: { email },
    data: {
      password: hashedPassword,
      passwordResetRequired: false,
      sessionVersion: { increment: 1 },
    },
  });

  logger.info({ msg: '[auth] Forced password reset completed', email: maskEmail(email) });
  // F-001: forced password reset completed (user re-authenticated with current pw).
  await audit({
    action: 'auth.password.reset',
    actorId: user.id,
    actorRole: user.role,
    organizationId: user.organizationId ?? undefined,
    ...getClientContext(await headers()),
    metadata: { email: maskEmail(email), method: 'forced' },
  });
  return { success: true };
}

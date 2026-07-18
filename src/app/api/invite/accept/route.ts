import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';
import { logger, maskEmail } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { verifyCaptcha } from '@/lib/captcha';
import { checkRateLimit } from '@/lib/rate-limit';
import { assertSeatAvailable, SeatLimitError } from '@/lib/seat-limits';
import { audit, getClientContext } from '@/lib/audit';
import { BCRYPT_COST } from '@/lib/bcrypt-config';
import { enrollUserForRoleTargets } from '@/lib/enrollment/role-targets';

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  firstName: z.string().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().min(1, 'Last name is required').max(100, 'Last name is too long'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
    .max(PASSWORD_MAX_LENGTH, 'Password is too long'),
  // Optional hCaptcha token; verified only when the feature is enabled (inert otherwise).
  captchaToken: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = acceptInviteSchema.safeParse(body);

    if (!result.success) {
      logger.warn({
        msg: '[invite] Rejected accept-invite request with invalid payload',
        fields: Object.keys(result.error.flatten().fieldErrors),
      });
      return NextResponse.json(
        { error: 'Invalid input data', details: result.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { token, firstName, lastName, password, captchaToken } = result.data;

    // Bot verification — no-op unless hCaptcha is enabled (see src/lib/captcha.ts).
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      'unknown';

    // F-037: rate-limit accept attempts per IP to blunt token brute-forcing and
    // abuse. 10 attempts / 15 minutes, consistent with other auth endpoints.
    // F-024: auth-critical — fail closed if Redis is down.
    const rateLimit = await checkRateLimit(`invite-accept:${ip}`, 10, 900, { failClosed: true });
    if (!rateLimit.allowed) {
      logger.warn({ msg: '[invite] Accept-invite rate limit exceeded', ip });
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429 },
      );
    }

    const captchaValid = await verifyCaptcha(captchaToken, ip);
    if (!captchaValid) {
      logger.warn({ msg: '[invite] Accept-invite captcha verification failed', ip });
      return NextResponse.json(
        { error: 'Captcha verification failed. Please try again.' },
        { status: 400 },
      );
    }

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return NextResponse.json(
        { error: `Password does not meet requirements: ${pwCheck.errors.join(', ')}` },
        { status: 400 },
      );
    }

    // `token` is Zod-validated as a non-empty string and `token` is @unique, so
    // this lookup resolves to exactly the invite that owns the token or none —
    // a crafted POST can never widen to reach another organization's invite.
    const invite = await prisma.invite.findUnique({
      where: { token, status: 'pending' },
    });

    if (!invite || new Date() > invite.expiresAt) {
      logger.warn({
        msg: '[invite] Accept attempt with invalid or expired token',
        tokenPrefix: token.slice(0, 8),
      });
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

    const facility = await prisma.facility.findFirst({
      where: { organizationId: invite.organizationId },
      select: { id: true },
    });
    if (!facility) {
      logger.warn({
        msg: '[invite] Accepting invite: no facility for organization',
        organizationId: invite.organizationId,
      });
    }

    const newUser = await prisma.$transaction(async (tx) => {
      // F-022: re-check seat availability INSIDE the transaction so a seat that
      // filled between invite issuance and acceptance (concurrent accepts, or
      // seats consumed since the invite was sent) is caught race-safely. Counts
      // workers against the org's plan staffMax via the shared BILLING_PLANS
      // source; a no-op for unlimited plans / no active subscription.
      await assertSeatAvailable(invite.organizationId, { seatsNeeded: 1, client: tx });

      const user = await tx.user.create({
        data: {
          email: invite.email,
          emailVerified: true,
          password: hashedPassword,
          organizationId: invite.organizationId,
          facilityId: facility?.id ?? null,
          role: invite.role,
          profile: {
            create: {
              firstName,
              lastName,
              fullName: `${firstName} ${lastName}`,
              email: invite.email,
            },
          },
        },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      });

      return user;
    });

    // F-001: invite accepted — a new credentialed account joined the org.
    await audit({
      action: 'auth.invite.accept',
      actorId: newUser.id,
      actorRole: invite.role,
      organizationId: invite.organizationId ?? undefined,
      targetType: 'invite',
      targetId: invite.id,
      ...getClientContext(req.headers),
      metadata: { email: maskEmail(invite.email) },
    });

    // Live auto-enroll: a new account just joined the org with a role — enroll it
    // in any active role-target assignments for that role. Never throws.
    await enrollUserForRoleTargets(newUser.id, invite.organizationId);

    return NextResponse.json({ success: true, userId: newUser.id });
  } catch (error: unknown) {
    // Seat limit hit between issuance and acceptance — surface a clear 409 with
    // the user-safe message rather than a generic 500.
    if (error instanceof SeatLimitError) {
      logger.warn({ msg: '[invite] Accept blocked — plan seat limit reached' });
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const err = error as Error;
    logger.error({ msg: 'Error accepting invite:', err: err });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

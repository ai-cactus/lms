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
import { enrollInviteCourses } from '@/lib/enrollment/invite-courses';
import { emitNotificationEvent } from '@/lib/notifications/emit';
import { getRoleDisplayName } from '@/lib/rbac/role-utils';
import { createMembership } from '@/lib/auth/membership';
import { captureServer } from '@/lib/analytics/server';

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
      select: { id: true },
    });

    // An identity may already exist (in this org or another — multi-org
    // membership is the point of this model). Only an ACTIVE membership in
    // THIS invite's organization is a true duplicate accept.
    if (existingUser) {
      const existingMembership = await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId: invite.organizationId },
        },
        select: { active: true },
      });
      if (existingMembership?.active) {
        return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
      }
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
    const fullName = `${firstName} ${lastName}`;

    const newUser = await prisma.$transaction(async (tx) => {
      // F-022: re-check seat availability INSIDE the transaction so a seat that
      // filled between invite issuance and acceptance (concurrent accepts, or
      // seats consumed since the invite was sent) is caught race-safely. Counts
      // workers against the org's plan staffMax via the shared BILLING_PLANS
      // source; a no-op for unlimited plans / no active subscription.
      await assertSeatAvailable(invite.organizationId, { seatsNeeded: 1, client: tx });

      // Relink an existing identity (rejoining, or joining an additional org):
      // reset its credentials and verification, and refresh its name — the
      // emailed token proves control of the address, the same trust model as a
      // password-reset link.
      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              emailVerified: true,
              password: hashedPassword,
              firstName,
              lastName,
              fullName,
            },
          })
        : await tx.user.create({
            data: {
              email: invite.email,
              emailVerified: true,
              password: hashedPassword,
              firstName,
              lastName,
              fullName,
            },
          });

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      });

      return user;
    });

    // Attach the (new-or-relinked) identity to the inviting org, on the
    // invite's facility, with the invited role.
    const membership = await createMembership({
      userId: newUser.id,
      organizationId: invite.organizationId,
      facilityId: invite.facilityId,
      role: invite.role,
    });

    // F-001: invite accepted — a new credentialed account joined the org.
    await audit({
      action: 'auth.invite.accept',
      actorId: newUser.id,
      actorRole: invite.role,
      organizationId: invite.organizationId,
      targetType: 'invite',
      targetId: invite.id,
      ...getClientContext(req.headers),
      metadata: { email: maskEmail(invite.email) },
    });

    // Live auto-enroll: a new account just joined the org with a role — enroll it
    // in any active role-target assignments for that role. Never throws.
    await enrollUserForRoleTargets(membership.organizationUserId, invite.organizationId);

    // Materialise any courses parked on this invite (assigned to the email before
    // the account existed) into real enrollments. Never throws.
    await enrollInviteCourses(membership.organizationUserId, invite.id);

    // Staff addition is recorded at acceptance, not at invite creation — an
    // invite is intent, an accepted invite is a real member. The inviter is the
    // actor, which is what routes an HR-sent invite to the owner and everyone
    // else's to HR (falling back to the owner). Never throws.
    const inviterMembership = invite.invitedBy
      ? await prisma.organizationUser.findFirst({
          where: { userId: invite.invitedBy, organizationId: invite.organizationId },
          select: { role: true },
        })
      : null;

    const roleLabel = getRoleDisplayName(invite.role);
    await emitNotificationEvent({
      organizationId: invite.organizationId,
      type: 'STAFF_ADDED',
      title: 'New staff member added',
      message: `${fullName} joined as ${roleLabel} via invitation.`,
      actor:
        inviterMembership && invite.invitedBy
          ? { userId: invite.invitedBy, role: inviterMembership.role }
          : null,
      subjectUserId: newUser.id,
      facilityId: invite.facilityId,
      linkUrl: `/dashboard/staff/${membership.organizationUserId}`,
      context: { workerName: fullName, roleLabel, addedVia: 'invite' },
    });

    // The invite's own createdAt dates the send, so this measures how long an
    // invite sat before the recipient acted — the number that justifies (or
    // kills) the reminder cadence.
    captureServer(
      'invite_accepted',
      () => ({
        role: invite.role,
        days_since_invited: invite.createdAt
          ? Math.floor((Date.now() - invite.createdAt.getTime()) / 86_400_000)
          : null,
      }),
      { distinctId: newUser.id, organizationId: invite.organizationId },
    );

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

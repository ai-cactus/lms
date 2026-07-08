import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  firstName: z.string().min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string().min(1, 'Last name is required').max(100, 'Last name is too long'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
    .max(PASSWORD_MAX_LENGTH, 'Password is too long'),
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

    const { token, firstName, lastName, password } = result.data;

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

    const hashedPassword = await bcrypt.hash(password, 10);

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

    return NextResponse.json({ success: true, userId: newUser.id });
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ msg: 'Error accepting invite:', err: err });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

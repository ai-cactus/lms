import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/password-policy';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { verifyCaptcha } from '@/lib/captcha';

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
    const captchaValid = await verifyCaptcha(captchaToken, ip);
    if (!captchaValid) {
      logger.warn({ msg: '[invite] Accept-invite captcha verification failed', ip });
      return NextResponse.json(
        { error: 'Captcha verification failed. Please try again.' },
        { status: 400 },
      );
    }

    // Server-side password policy enforcement (beyond basic zod length checks)
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      return NextResponse.json(
        { error: `Password does not meet requirements: ${pwCheck.errors.join(', ')}` },
        { status: 400 },
      );
    }

    // 2. Find pending invite
    const invite = await prisma.invite.findUnique({
      where: { token, status: 'pending' },
    });

    if (!invite || new Date() > invite.expiresAt) {
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 });
    }

    // 3. Check if user already exists (just in case they signed up manually in the meantime)
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Create User and Profile within a transaction
    // Using transaction ensures atomicity
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.email,
          password: hashedPassword,
          organizationId: invite.organizationId,
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

      // 6. Mark invite as accepted
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

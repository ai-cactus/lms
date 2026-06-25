import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendEmailVerification } from '@/lib/email';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { EMAIL_VERIFICATION_EXPIRY_MS } from '@/lib/auth-constants';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting — 5 attempts per IP per 10 minutes, before any DB access.
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';
    const { allowed } = await checkRateLimit(`resend-verification:${ip}`, 5, 600);
    if (!allowed) {
      logger.warn({ msg: '[auth] Resend verification rate limit exceeded', ip });
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429 },
      );
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    // Check if user already exists (already verified)
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Email is already verified' },
        { status: 400 },
      );
    }

    // Find existing pending verification token to get user data
    const existingToken = await prisma.verificationToken.findFirst({
      where: { identifier: email, type: 'email_verification' },
    });

    if (
      !existingToken ||
      !existingToken.password ||
      !existingToken.firstName ||
      !existingToken.lastName
    ) {
      // No pending signup found
      return NextResponse.json(
        { success: false, error: 'No pending signup found. Please sign up again.' },
        { status: 400 },
      );
    }

    // Delete old token and create new one with fresh expiry
    await prisma.verificationToken.delete({
      where: {
        identifier_token: {
          identifier: existingToken.identifier,
          token: existingToken.token,
        },
      },
    });

    // Create new verification token with preserved user data (24 hour expiry)
    const newToken = crypto.randomUUID();
    const expires = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: newToken,
        type: 'email_verification',
        expires,
        password: existingToken.password,
        firstName: existingToken.firstName,
        lastName: existingToken.lastName,
        role: existingToken.role,
      },
    });

    // Send verification email
    const result = await sendEmailVerification(email, newToken);

    if (!result.success) {
      return NextResponse.json({ success: false, error: 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: 'Resend verification error:', err: error });
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

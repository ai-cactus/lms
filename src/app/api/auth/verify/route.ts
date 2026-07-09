import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { UserRole } from '@/generated/prisma/enums';
import { logger } from '@/lib/logger';
import { ALL_ROLES, DEFAULT_SELF_SERVE_WORKER_ROLE } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

const getBaseUrl = () => {
  return (
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://staging-lms.theraptly.com'
  );
};

// GET request now just redirects to the frontend verify page
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const baseUrl = getBaseUrl();

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/verify-email?error=missing_token`);
  }

  // Redirect to the new frontend page that handles the POST
  return NextResponse.redirect(`${baseUrl}/verify?token=${token}`);
}

// POST request actually performs the verification (prevents email scanner auto-clicks from consuming the token)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ success: false, error: 'missing_token' }, { status: 400 });
    }

    // Find the verification token with pending user data
    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        token,
        type: 'email_verification',
        expires: { gt: new Date() },
      },
    });

    if (!verificationToken) {
      return NextResponse.json({ success: false, error: 'invalid_or_expired' }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: verificationToken.identifier },
    });

    if (existingUser) {
      // User already exists, just delete token and return success
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: verificationToken.identifier,
            token: verificationToken.token,
          },
        },
      });
      return NextResponse.json({ success: true, role: existingUser.role });
    }

    // Create the user and profile from pending data
    if (
      !verificationToken.password ||
      !verificationToken.firstName ||
      !verificationToken.lastName
    ) {
      return NextResponse.json({ success: false, error: 'invalid_data' }, { status: 400 });
    }

    // Validate the pending role against the current role set before trusting it.
    // A token minted before the RBAC rollout may still carry a retired value
    // (e.g. `admin`); anything not in ALL_ROLES falls back to the default worker role.
    const pendingRole = verificationToken.role;
    const userRole: UserRole =
      pendingRole && ALL_ROLES.includes(pendingRole as Role)
        ? (pendingRole as UserRole)
        : DEFAULT_SELF_SERVE_WORKER_ROLE;

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: verificationToken.identifier,
          password: verificationToken.password!,
          emailVerified: true,
          role: userRole,
        },
      });

      await tx.profile.create({
        data: {
          id: user.id,
          email: user.email,
          firstName: verificationToken.firstName!,
          lastName: verificationToken.lastName!,
          fullName: `${verificationToken.firstName} ${verificationToken.lastName}`,
        },
      });

      await tx.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: verificationToken.identifier,
            token: verificationToken.token,
          },
        },
      });
    });

    return NextResponse.json({ success: true, role: userRole });
  } catch (error) {
    logger.error({ msg: 'Verification POST error:', err: error });
    return NextResponse.json({ success: false, error: 'server_error' }, { status: 500 });
  }
}

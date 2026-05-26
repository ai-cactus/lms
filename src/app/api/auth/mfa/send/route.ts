import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendLoginMfaCode } from '@/app/actions/mfa';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId } = body as { userId?: string };

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true, mfaFactors: { where: { type: 'email', verified: true } } },
    });

    if (!user || !user.mfaEnabled || user.mfaFactors.length === 0) {
      // Return 200 anyway so we don't leak user existence/MFA status
      return NextResponse.json({ success: true });
    }

    await sendLoginMfaCode(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: 'MFA send code error', error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

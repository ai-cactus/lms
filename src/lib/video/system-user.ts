import crypto from 'crypto';
import prisma from '@/lib/prisma';

export const SYSTEM_USER_EMAIL = 'system@theraptly.internal';

/** Idempotently returns the single platform "System" user that owns all global video courses. */
export async function getOrCreateSystemUser() {
  return prisma.user.upsert({
    where: { email: SYSTEM_USER_EMAIL },
    update: {},
    create: {
      email: SYSTEM_USER_EMAIL,
      // Never logs in: a random non-bcrypt string can never match bcrypt.compare.
      password: crypto.randomBytes(32).toString('hex'),
      // Internal platform user (no org). Maps to the legacy `admin` successor.
      role: 'supervisor',
      organizationId: null,
      emailVerified: true,
    },
  });
}

import 'server-only';

import prisma from '@/lib/prisma';
import { logger, maskEmail } from '@/lib/logger';

/**
 * Q-31 (ruled 2026-09-29): an invite or course assignment to a deleted
 * identity's email is refused up front — no invite row, no email. Accepting one
 * would be refused anyway (the email is not freed, see
 * `src/lib/system/delete-user.ts`), so issuing it only strands the recipient.
 *
 * The message is deliberately generic: the org admin sending the invite must not
 * learn that the person's account was deleted by the platform.
 */
export const DELETED_EMAIL_REFUSAL = "This email can't be invited. Contact support.";

/**
 * The lower-cased emails among `emails` that belong to a deleted identity.
 * Matched case-insensitively, like every other email comparison on the invite
 * paths.
 */
export async function findDeletedIdentityEmails(emails: readonly string[]): Promise<Set<string>> {
  const candidates = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(
    Boolean,
  );
  if (candidates.length === 0) return new Set();

  const deleted = await prisma.user.findMany({
    where: { email: { in: candidates, mode: 'insensitive' }, deletedAt: { not: null } },
    select: { email: true },
  });
  return new Set(deleted.map((user) => user.email.toLowerCase()));
}

/** Records one refusal. The email is masked; the org and path identify the caller. */
export function logDeletedEmailRefusal(
  source: string,
  email: string,
  organizationId: string | null | undefined,
): void {
  logger.warn({
    msg: '[invite] Refused to invite or assign a deleted identity',
    source,
    email: maskEmail(email),
    orgId: organizationId ?? undefined,
  });
}

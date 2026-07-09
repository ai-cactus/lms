'use server';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import JoinPageClient from '@/app/join/[token]/JoinPageClient';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Fail closed on a missing/blank token before touching the database. Prisma
  // silently drops a strict-`undefined` filter, so an unguarded lookup would
  // widen to match an unrelated invite — never let that happen.
  if (typeof token !== 'string' || token.trim() === '') {
    logger.warn({ msg: '[invite] Join page requested without a valid token', tokenLength: 0 });
    return notFound();
  }

  // `token` is @unique, so a single lookup by exact token can only ever return
  // the invite that owns it (or none) — no cross-org/cross-invite match possible.
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { organization: true },
  });

  // Valid, unexpired, still-pending invite → render the account-creation form.
  if (invite && invite.status === 'pending' && new Date() <= invite.expiresAt) {
    return <JoinPageClient invite={invite} orgName={invite.organization.name} />;
  }

  // Distinguish an invite that has already been accepted from a genuinely
  // unknown/expired token so we can show an actionable message instead of a 404.
  if (invite?.status === 'accepted') {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background-secondary px-4 py-10">
        <div className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary-light to-primary" />
          <div className="flex flex-col items-center gap-6 p-6 text-center sm:p-8">
            <Logo size="md" />
            <div className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                This invite has already been used
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                An account has already been created with this invitation. Please log in to continue.
              </p>
            </div>
            <Button asChild size="lg" className="w-full">
              <Link href="/login">Go to login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Unknown or expired token → genuine 404.
  logger.warn({
    msg: '[invite] Join page: no valid pending invite for token',
    tokenPrefix: token.slice(0, 8),
  });
  return notFound();
}

'use server';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import JoinPageClient from '@/app/join/[token]/JoinPageClient';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { Logo } from '@/components/ui';
import { Button } from '@/components/ui/button';

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await prisma.invite.findFirst({
    where: { token, status: 'pending' },
    include: { organization: true },
  });

  // Valid, unexpired, still-pending invite → render the account-creation form.
  if (invite && new Date() <= invite.expiresAt) {
    return <JoinPageClient invite={invite} orgName={invite.organization.name} />;
  }

  // The strict lookup missed (or the invite is expired). Distinguish an invite
  // that has already been accepted from a genuinely unknown/expired token so we
  // can show an actionable message instead of a bare 404.
  const anyInvite = await prisma.invite.findFirst({
    where: { token },
    select: { status: true },
  });

  if (anyInvite?.status === 'accepted') {
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
  return notFound();
}

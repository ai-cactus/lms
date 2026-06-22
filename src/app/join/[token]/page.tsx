'use server';

import JoinPageClient from '@/app/join/[token]/JoinPageClient';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';

export default async function JoinPage({ params }: { params: { token: string } }) {
  const invite = await prisma.invite.findFirst({
    where: { token: params.token, status: 'pending' },
    include: { organization: true },
  });

  if (!invite || new Date() > invite.expiresAt) {
    // Handle invalid or expired token
    // In a real app, show a nice error page or redirect to a "Request new invite" page
    return notFound();
  }

  return <JoinPageClient invite={invite} orgName={invite.organization.name} />;
}

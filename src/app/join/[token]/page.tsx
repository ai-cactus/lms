'use server';

import { PrismaClient } from '@prisma/client';
import JoinPageClient from '@/app/join/[token]/JoinPageClient';
import { notFound } from 'next/navigation';

const prisma = new PrismaClient();

export default async function JoinPage({ params }: { params: { token: string } }) {
    const { token } = params;

    const invite = await prisma.invite.findUnique({
        where: { token, status: 'pending' },
        include: { organization: true }
    });

    if (!invite || new Date() > invite.expiresAt) {
        // Handle invalid or expired token
        // In a real app, show a nice error page or redirect to a "Request new invite" page
        return notFound();
    }

    return (
        <JoinPageClient
            invite={invite}
            orgName={invite.organization.name}
        />
    );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { ADMIN_ROLES } from '@/lib/rbac/role-utils';
import SettingsClient, {
  type SettingsTeamMember,
} from '@/components/dashboard/settings/SettingsClient';
import type { Role } from '@/types/next-auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings | Theraptly',
  description: 'Manage your facility, team access, and account preferences.',
};

export default async function SettingsPageRoute() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, organizationId: true },
  });

  if (!user) {
    redirect('/login');
  }

  // Settings is owner-only. Other admins reaching this URL get a proper
  // access-denied state (mirrors the Billing route's gate pattern).
  if (user.role !== 'owner') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">
          You don&apos;t have access to Settings
        </h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Facility and team-access settings are limited to your organization&apos;s owner.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const organizationId = user.organizationId;

  if (!organizationId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">No organization found</h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Complete onboarding to set up your facility before managing settings.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const now = new Date();
  const adminRoleFilter = { in: [...ADMIN_ROLES] };

  const [members, adminInvites, facility, subscription, workerCount, pendingInviteCount, allUsers] =
    await Promise.all([
      // Admin-tier team members (owner + managers) shown on Users & Permissions.
      prisma.user.findMany({
        where: { organizationId, role: adminRoleFilter },
        select: {
          id: true,
          email: true,
          role: true,
          lastLoginAt: true,
          profile: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Pending admin-role invites (not yet accepted / not expired).
      prisma.invite.findMany({
        where: {
          organizationId,
          role: adminRoleFilter,
          status: 'pending',
          expiresAt: { gt: now },
        },
        select: { id: true, email: true, role: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.facility.findFirst({
        where: { organizationId },
        select: { id: true, name: true, type: true },
      }),
      prisma.subscription.findUnique({
        where: { organizationId },
        select: { plan: true, status: true },
      }),
      // Seat accounting for the invite modal — every role except owner consumes a seat.
      prisma.user.count({ where: { organizationId, role: { not: 'owner' } } }),
      prisma.invite.count({
        where: {
          organizationId,
          role: { not: 'owner' },
          status: 'pending',
          expiresAt: { gt: now },
        },
      }),
      // Emails already present (members + pending invites) — flags CSV dupes.
      prisma.user.findMany({ where: { organizationId }, select: { email: true } }),
    ]);

  const activeMembers: SettingsTeamMember[] = members.map((member) => ({
    id: member.id,
    name: member.profile?.fullName || member.email.split('@')[0],
    email: member.email,
    role: member.role as Role,
    lastLoginAt: member.lastLoginAt ? member.lastLoginAt.toISOString() : null,
    isPending: false,
  }));

  const memberEmails = new Set(members.map((member) => member.email.toLowerCase()));
  const pendingMembers: SettingsTeamMember[] = adminInvites
    .filter((invite) => !memberEmails.has(invite.email.toLowerCase()))
    .map((invite) => ({
      id: invite.id,
      name: invite.email.split('@')[0],
      email: invite.email,
      role: invite.role as Role,
      lastLoginAt: null,
      isPending: true,
    }));

  let planLimit: number | null = null;
  let planName = '';
  if (subscription && subscription.status !== 'canceled') {
    const planConfig = BILLING_PLANS.find((plan) => plan.key === subscription.plan);
    if (planConfig) {
      planLimit = planConfig.staffMax;
      planName = planConfig.name;
    }
  }

  const remainingSeats =
    planLimit !== null ? Math.max(0, planLimit - (workerCount + pendingInviteCount)) : null;

  const pendingInviteEmails = adminInvites.map((invite) => invite.email);
  const existingEmails = [...allUsers.map((u) => u.email), ...pendingInviteEmails];

  return (
    <SettingsClient
      teamMembers={[...activeMembers, ...pendingMembers]}
      facility={facility}
      planName={planName}
      inviterRole={user.role as Role}
      remainingSeats={remainingSeats}
      existingEmails={existingEmails}
    />
  );
}

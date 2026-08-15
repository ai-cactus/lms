import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { BILLING_PLANS } from '@/lib/billing-plans';
import { ADMIN_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import SettingsClient, {
  type SettingsFacility,
  type SettingsTeamMember,
} from '@/components/dashboard/settings/SettingsClient';
import { getNotificationCategoryPreferences } from '@/lib/notifications/category-preferences';
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

  const { role, organizationId } = session.user;

  // Facility + team-access settings are an org-level mutation, so this gate keys
  // off `organization.edit` — Owner-equivalent seats only. Kept in lockstep with
  // the Settings nav row in roles-matrix-config so the menu never offers a link
  // this route then refuses. Other admins get a proper access-denied state
  // (mirrors the Billing route's gate pattern).
  if (!can(dbRoleToRoleKey(role), 'organization.edit')) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">
          You don&apos;t have access to Settings
        </h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Facility and team-access settings are limited to your organization&apos;s owner and
          admins.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

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

  const [
    members,
    adminInvites,
    orgFacilities,
    subscription,
    workerCount,
    pendingInviteCount,
    allMembers,
    organization,
    categoryPreferences,
  ] = await Promise.all([
    // Admin-tier team members (owner + managers) shown on Users & Permissions.
    prisma.organizationUser.findMany({
      where: { organizationId, role: adminRoleFilter },
      select: {
        id: true,
        role: true,
        lastLoginAt: true,
        user: { select: { email: true, fullName: true } },
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
    // Every facility in the org, each with its active supervisor. The nested
    // read keeps this to one extra query rather than one per card.
    prisma.facility.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        type: true,
        address: true,
        userFacilities: {
          where: { active: true, organizationUser: { active: true, role: 'supervisor' } },
          select: {
            organizationUser: { select: { user: { select: { fullName: true, email: true } } } },
          },
          orderBy: { joinedAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.subscription.findUnique({
      where: { organizationId },
      select: { plan: true, status: true },
    }),
    // Seat accounting for the invite modal — every role except owner consumes a seat.
    prisma.organizationUser.count({ where: { organizationId, role: { not: 'owner' } } }),
    prisma.invite.count({
      where: {
        organizationId,
        role: { not: 'owner' },
        status: 'pending',
        expiresAt: { gt: now },
      },
    }),
    // Emails already present (members + pending invites) — flags CSV dupes.
    prisma.organizationUser.findMany({
      where: { organizationId },
      select: { user: { select: { email: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { notificationDigestFrequency: true },
    }),
    getNotificationCategoryPreferences(organizationId),
  ]);

  const facilities: SettingsFacility[] = orgFacilities.map((facility) => {
    const supervisor = facility.userFacilities[0]?.organizationUser.user ?? null;
    return {
      id: facility.id,
      name: facility.name,
      type: facility.type,
      address: facility.address,
      supervisorName: supervisor?.fullName || null,
      supervisorEmail: supervisor?.email ?? null,
    };
  });

  const activeMembers: SettingsTeamMember[] = members.map((member) => ({
    id: member.id,
    name: member.user.fullName || member.user.email.split('@')[0],
    email: member.user.email,
    role: member.role as Role,
    lastLoginAt: member.lastLoginAt ? member.lastLoginAt.toISOString() : null,
    isPending: false,
  }));

  const memberEmails = new Set(members.map((member) => member.user.email.toLowerCase()));
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
  const existingEmails = [...allMembers.map((m) => m.user.email), ...pendingInviteEmails];

  return (
    <SettingsClient
      teamMembers={[...activeMembers, ...pendingMembers]}
      facilities={facilities}
      planName={planName}
      inviterRole={role as Role}
      remainingSeats={remainingSeats}
      existingEmails={existingEmails}
      digestFrequency={organization?.notificationDigestFrequency ?? 'daily'}
      categoryPreferences={categoryPreferences}
    />
  );
}

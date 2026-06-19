import { redirect } from 'next/navigation';
import { Circle } from 'lucide-react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getAuditorOverviewStats, getAuditorCourses } from '@/app/actions/auditor';
import AuditorPackClient from '@/components/dashboard/auditor/AuditorPackClient';
import AuditorBillingGateWrapper from './AuditorBillingGateWrapper';
import { logger } from '@/lib/logger';

export const metadata = {
  title: 'Audit Reports | Theraptly LMS',
  description: 'Real-time compliance monitoring and audit reporting for your organization.',
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default async function AuditorPackPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organizationId: true,
      profile: { select: { firstName: true, fullName: true, hasSeenAuditorWelcome: true } },
      organization: { select: { hasAuditorAccess: true } },
    },
  });

  // Only admin users may access this page
  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  const firstName = user.profile?.firstName ?? 'there';
  const hasAccess = user.organization?.hasAuditorAccess ?? false;
  const showBanner = hasAccess && !user.profile?.hasSeenAuditorWelcome;

  if (showBanner) {
    // Mark as seen for future visits
    prisma.profile
      .update({
        where: { id: session.user.id },
        data: { hasSeenAuditorWelcome: true },
      })
      .catch((e) => logger.error({ msg: 'Failed to update welcome flag', err: e }));
  }

  // Pre-fetch data server-side so initial render is instant (only if has access)
  const [initialStats, initialCourses] = hasAccess
    ? await Promise.all([getAuditorOverviewStats(), getAuditorCourses()])
    : [{ totalCourses: 0, totalStaffAssigned: 0, completionRate: 0 }, []];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-7">
        <h1 className="mb-1 text-[28px] font-bold text-foreground">Audit Reports</h1>
        <p className="text-sm text-text-tertiary">
          Generate a scannable evidence document for auditors.
        </p>
      </div>

      {hasAccess ? (
        <>
          {/* Welcome Banner */}
          {showBanner && (
            <div className="relative mb-8 flex min-h-[180px] flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-[#3a2fd8] px-6 py-8 text-white sm:px-12 sm:py-10">
              {/* Decorative background shapes */}
              <div className="pointer-events-none absolute -right-5 -top-5 opacity-15" aria-hidden>
                <Circle className="size-48" strokeWidth={20} />
              </div>
              <p className="mb-1.5 text-sm opacity-90">
                {getGreeting()}, {firstName}!
              </p>
              <h2 className="mb-2.5 max-w-[540px] text-[28px] font-bold leading-tight">
                Welcome to Your Auditor Workspace!
              </h2>
              <p className="max-w-[480px] text-sm leading-relaxed opacity-85">
                Generate scannable evidence documents for auditors based on your learning
                management.
              </p>
            </div>
          )}

          {/* Tab Content */}
          <AuditorPackClient initialStats={initialStats} initialCourses={initialCourses} />
        </>
      ) : (
        <AuditorBillingGateWrapper />
      )}
    </div>
  );
}

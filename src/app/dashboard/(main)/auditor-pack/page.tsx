import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getAuditorOverviewStats, getAuditorCourses } from '@/app/actions/auditor';
import AuditorPackClient from '@/components/dashboard/auditor/AuditorPackClient';
import AuditorBillingGate from '@/components/dashboard/auditor/AuditorBillingGate';
import styles from '@/components/dashboard/auditor/auditor-pack.module.css';

export const metadata = {
  title: 'Auditor Pack | Theraptly LMS',
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
      profile: { select: { firstName: true, fullName: true } },
      organization: { select: { hasAuditorAccess: true } },
    },
  });

  // Only admin users may access this page
  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  const firstName = user.profile?.firstName ?? 'there';
  const hasAccess = user.organization?.hasAuditorAccess ?? false;

  // Pre-fetch data server-side so initial render is instant (only if has access)
  const [initialStats, initialCourses] = hasAccess
    ? await Promise.all([getAuditorOverviewStats(), getAuditorCourses()])
    : [{ totalCourses: 0, totalStaffAssigned: 0, completionRate: 0 }, []];

  return (
    <div>
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Auditor Pack</h1>
        <p className={styles.pageSubtitle}>Generate a scannable evidence document for auditors.</p>
      </div>

      {hasAccess ? (
        <>
          {/* Welcome Banner */}
          <div className={styles.welcomeBanner}>
            {/* Decorative background shapes */}
            <div className={styles.welcomeBannerDecoration} aria-hidden>
              <svg width="200" height="200" viewBox="0 0 200 200" fill="none">
                <circle cx="120" cy="80" r="70" stroke="white" strokeWidth="40" fill="none" />
                <circle cx="160" cy="30" r="40" stroke="white" strokeWidth="25" fill="none" />
              </svg>
            </div>
            <p className={styles.welcomeGreeting}>
              {getGreeting()}, {firstName}!
            </p>
            <h2 className={styles.welcomeHeading}>Welcome to Your Auditor Workspace!</h2>
            <p className={styles.welcomeDesc}>
              Generate scannable evidence documents for auditors based on your learning management.
            </p>
          </div>

          {/* Tab Content */}
          <AuditorPackClient initialStats={initialStats} initialCourses={initialCourses} />
        </>
      ) : (
        <AuditorBillingGate />
      )}
    </div>
  );
}

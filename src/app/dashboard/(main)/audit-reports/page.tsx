import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { ChevronRight } from 'lucide-react';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getAuditorOverviewStats } from '@/app/actions/auditor';
import { Button } from '@/components/ui/button';
import AuditorPackClient from '@/components/dashboard/auditor/AuditorPackClient';
import { auditPageSubtitle, auditPageTitle } from '@/components/dashboard/auditor/audit-ui';

export const metadata = {
  title: 'Audit Reports | Theraptly LMS',
  description: 'Real-time compliance monitoring and audit reporting for your organization.',
};

export default async function AuditorPackPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { role, organizationId } = session.user;

  // Only admin users may access this page
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { hasAuditorAccess: true },
      })
    : null;

  const hasAccess = organization?.hasAuditorAccess ?? false;

  if (!hasAccess) {
    return (
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-[5px]">
          <h1 className={auditPageTitle}>Audit Reports</h1>
          <p className={auditPageSubtitle}>Generate a scannable evidence document for auditors.</p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
          <div className="flex w-full max-w-[420px] flex-col items-center gap-5">
            <Image
              src="/images/audit-empty-state.svg"
              alt=""
              width={187}
              height={150}
              aria-hidden="true"
              className="h-[150px] w-auto md:h-[188px]"
            />
            <div className="flex flex-col gap-1.5 text-center">
              <p className="text-[20px] font-semibold leading-[1.32] text-[#11181c] md:text-[22px]">
                Billing required for reports
              </p>
              <p className="text-[15px] leading-[1.45] text-[#475367]">
                Subscribe to a plan to generate Audit Reports.
              </p>
            </div>
            <Button asChild className="h-11 gap-2 rounded-[8px] px-5 text-[14px] font-semibold">
              <Link href="/dashboard/billing">
                Select a plan
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const stats = await getAuditorOverviewStats();

  return <AuditorPackClient stats={stats} />;
}

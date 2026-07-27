'use client';

import { usePathname } from 'next/navigation';
import ProfileDashboardLayout from './ProfileDashboardLayout';
import DefaultDashboardLayout from './DefaultDashboardLayout';
import { FC } from 'react';

interface Props {
  children: React.ReactNode;
  fullName: string;
  role: string | undefined;
}

const DashboardLayoutClient: FC<Props> = ({ children, fullName, role }) => {
  const pathname = usePathname();
  const isProfilePage = pathname === '/dashboard/profile';

  if (isProfilePage) {
    return <ProfileDashboardLayout fullName={fullName}>{children}</ProfileDashboardLayout>;
  }

  return (
    <DefaultDashboardLayout role={role} fullName={fullName}>
      {children}
    </DefaultDashboardLayout>
  );
};

export default DashboardLayoutClient;

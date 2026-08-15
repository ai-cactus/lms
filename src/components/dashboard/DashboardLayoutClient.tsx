'use client';

import { usePathname } from 'next/navigation';
import ProfileDashboardLayout from './ProfileDashboardLayout';
import DefaultDashboardLayout from './DefaultDashboardLayout';
import { FC } from 'react';

interface Props {
  children: React.ReactNode;
  fullName: string;
  role: string | undefined;
  organizationName?: string;
  roleDisplayName?: string;
  facilityName?: string | null;
}

const DashboardLayoutClient: FC<Props> = ({
  children,
  fullName,
  role,
  organizationName,
  roleDisplayName,
  facilityName,
}) => {
  const pathname = usePathname();
  const isProfilePage = pathname === '/dashboard/profile';

  if (isProfilePage) {
    return (
      <ProfileDashboardLayout
        fullName={fullName}
        organizationName={organizationName}
        roleDisplayName={roleDisplayName}
      >
        {children}
      </ProfileDashboardLayout>
    );
  }

  return (
    <DefaultDashboardLayout
      role={role}
      fullName={fullName}
      organizationName={organizationName}
      roleDisplayName={roleDisplayName}
      facilityName={facilityName}
    >
      {children}
    </DefaultDashboardLayout>
  );
};

export default DashboardLayoutClient;

import { FC } from 'react';
import { ProfileDashboardNavBar } from './NavBar';

interface Props {
  children: React.ReactNode;
  fullName: string;
  organizationName?: string;
  roleDisplayName?: string;
}

const ProfileDashboardLayout: FC<Props> = ({
  children,
  fullName,
  organizationName,
  roleDisplayName,
}) => {
  return (
    <div className="flex h-full flex-col bg-white">
      <ProfileDashboardNavBar
        fullName={fullName}
        organizationName={organizationName}
        roleDisplayName={roleDisplayName}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
};

export default ProfileDashboardLayout;

'use client';

import { useState } from 'react';
import ProfileSettingsShell from './ProfileSettingsShell';
import { ChangePasswordTab } from '../ChangePasswordTab';
import { TwoFactorAuthTab } from '../TwoFactorAuthTab';
import MyProfileSection from './MyProfileSection';
import MyOrganizationSection from './MyOrganizationSection';
import MyFacilitiesSection from './MyFacilitiesSection';
import AssignedFacilitiesSection from './AssignedFacilitiesSection';
import type {
  ComplianceDocument,
  FacilitiesMode,
  FacilityCardData,
  OrganizationSectionData,
  ProfileData,
} from './types';

type SectionKey = 'profile' | 'organization' | 'facilities' | 'password' | '2fa';

interface ProfileSettingsProps {
  profile: ProfileData;
  organization: OrganizationSectionData | null;
  complianceDocuments: ComplianceDocument[];
  facilities: FacilityCardData[];
  /** `organization.read` for an org-wide seat — supervisors have no org panel. */
  showOrganization: boolean;
  /** `organization.edit` — without it the panel stays read-only. */
  canEditOrganization: boolean;
  facilitiesMode: FacilitiesMode;
}

export default function ProfileSettings({
  profile,
  organization,
  complianceDocuments,
  facilities,
  showOrganization,
  canEditOrganization,
  facilitiesMode,
}: ProfileSettingsProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>('profile');

  const navItems: { key: SectionKey; label: string }[] = [
    { key: 'profile', label: 'My Profile' },
    ...(showOrganization ? [{ key: 'organization' as const, label: 'My Organization' }] : []),
    ...(facilitiesMode === 'none'
      ? []
      : [
          {
            key: 'facilities' as const,
            label: facilitiesMode === 'assigned' ? 'Assigned Facilities' : 'My Facilities',
          },
        ]),
    { key: 'password', label: 'Change Password' },
    { key: '2fa', label: 'Two-factor Authentication' },
  ];

  return (
    <ProfileSettingsShell
      backHref="/dashboard"
      navItems={navItems}
      activeKey={activeSection}
      onSelect={setActiveSection}
    >
      {activeSection === 'profile' && (
        <MyProfileSection profile={profile} organizationName={organization?.name ?? null} />
      )}

      {activeSection === 'organization' && showOrganization && (
        <MyOrganizationSection
          organization={organization}
          complianceDocuments={complianceDocuments}
          canEdit={canEditOrganization}
        />
      )}

      {activeSection === 'facilities' &&
        (facilitiesMode === 'assigned' ? (
          <AssignedFacilitiesSection facilities={facilities} />
        ) : (
          <MyFacilitiesSection facilities={facilities} />
        ))}

      {activeSection === 'password' && (
        <div className="flex flex-col gap-6">
          <h2 className="text-xl font-semibold text-foreground">Change Password</h2>
          <ChangePasswordTab authProvider={profile.authProvider} />
        </div>
      )}

      {activeSection === '2fa' && (
        <div className="flex flex-col gap-6">
          <h2 className="text-xl font-semibold text-foreground">Two-factor Authentication</h2>
          <TwoFactorAuthTab userEmail={profile.email} />
        </div>
      )}
    </ProfileSettingsShell>
  );
}

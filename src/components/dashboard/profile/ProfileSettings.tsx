'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
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
    <div className="flex flex-col px-6 pt-8 pb-16 lg:px-[92px] lg:pt-10">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-2 text-base font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground lg:text-[28px]">Profile Settings</h1>

      <div className="mt-8 flex flex-col gap-6 lg:mt-10 lg:flex-row lg:gap-0">
        {/* Below lg the nav collapses to a single scrollable row of the same
            pills, so the content pane keeps the full width on small screens. */}
        <div
          role="tablist"
          aria-label="Profile settings sections"
          aria-orientation="vertical"
          className="flex shrink-0 gap-2 overflow-x-auto [scrollbar-width:none] lg:sticky lg:top-10 lg:w-[280px] lg:flex-col lg:gap-1 lg:self-start lg:overflow-visible lg:border-r lg:border-border lg:pr-6 [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`profile-tab-${item.key}`}
              aria-selected={activeSection === item.key}
              aria-controls="profile-section-panel"
              onClick={() => setActiveSection(item.key)}
              className={cn(
                'shrink-0 cursor-pointer rounded-full px-5 py-3 text-left text-base font-medium whitespace-nowrap transition-colors lg:whitespace-normal',
                activeSection === item.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-background-secondary',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="profile-section-panel"
          aria-labelledby={`profile-tab-${activeSection}`}
          className="min-w-0 flex-1 lg:pl-8"
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
        </div>
      </div>
    </div>
  );
}

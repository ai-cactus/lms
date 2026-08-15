'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InviteStaffModal from '@/components/dashboard/staff/InviteStaffModal';
import UsersPermissionsTab from './UsersPermissionsTab';
import RolesMatrixTab from './RolesMatrixTab';
import FacilityTab from './FacilityTab';
import NotificationSettingsTab from './NotificationSettingsTab';
import type { Role } from '@/types/next-auth';
import type { DigestFrequency } from '@/generated/prisma/enums';
import type { NotificationCategoryPreferenceMap } from '@/lib/notifications/catalog';

export interface SettingsTeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** ISO timestamp of last sign-in, or null if the user has never signed in. */
  lastLoginAt: string | null;
  isPending: boolean;
}

export interface SettingsFacility {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  /** Active supervisor of this facility, or null when the seat is vacant. */
  supervisorName: string | null;
  supervisorEmail: string | null;
}

interface SettingsClientProps {
  teamMembers: SettingsTeamMember[];
  facilities: SettingsFacility[];
  planName: string;
  inviterRole: Role;
  remainingSeats: number | null;
  existingEmails: string[];
  digestFrequency: DigestFrequency;
  categoryPreferences: NotificationCategoryPreferenceMap;
}

const TAB_TRIGGER_CLASS =
  '-mb-px flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0.5 pb-2.5 text-sm font-medium text-[#818898] shadow-none after:hidden hover:text-foreground data-[state=active]:border-[#5c47ff] data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-[#5c47ff] data-[state=active]:shadow-none';

export default function SettingsClient({
  teamMembers,
  facilities,
  planName,
  inviterRole,
  remainingSeats,
  existingEmails,
  digestFrequency,
  categoryPreferences,
}: SettingsClientProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-8 flex flex-col gap-[5px]">
        <h1 className="text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
          Settings
        </h1>
        <p className="text-sm leading-tight font-medium text-[#a0aec0]">
          Manage your facility, team access, and account preferences
        </p>
      </header>

      <Tabs defaultValue="users">
        <TabsList
          variant="line"
          className="mb-10 h-auto w-full justify-start gap-8 rounded-none border-b border-[#f0f2f5] bg-transparent p-0"
        >
          <TabsTrigger value="users" className={TAB_TRIGGER_CLASS}>
            Users &amp; Permissions
          </TabsTrigger>
          <TabsTrigger value="roles" className={TAB_TRIGGER_CLASS}>
            Roles
          </TabsTrigger>
          <TabsTrigger value="facility" className={TAB_TRIGGER_CLASS}>
            Facility
          </TabsTrigger>
          <TabsTrigger value="notifications" className={TAB_TRIGGER_CLASS}>
            Notification
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersPermissionsTab members={teamMembers} onInvite={() => setShowInviteModal(true)} />
        </TabsContent>

        <TabsContent value="roles">
          <RolesMatrixTab />
        </TabsContent>

        <TabsContent value="facility">
          <FacilityTab facilities={facilities} viewerRole={inviterRole} />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettingsTab
            digestFrequency={digestFrequency}
            categoryPreferences={categoryPreferences}
          />
        </TabsContent>
      </Tabs>

      <InviteStaffModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        remainingSeats={remainingSeats}
        planName={planName}
        inviterRole={inviterRole}
        existingEmails={existingEmails}
        facilities={facilities}
      />
    </div>
  );
}

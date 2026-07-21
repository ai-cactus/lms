'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InviteStaffModal from '@/components/dashboard/staff/InviteStaffModal';
import UsersPermissionsTab from './UsersPermissionsTab';
import RolesMatrixTab from './RolesMatrixTab';
import FacilityTab from './FacilityTab';
import type { Role } from '@/types/next-auth';

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
}

interface SettingsClientProps {
  teamMembers: SettingsTeamMember[];
  facility: SettingsFacility | null;
  planName: string;
  inviterRole: Role;
  remainingSeats: number | null;
  existingEmails: string[];
}

const TAB_TRIGGER_CLASS =
  'flex-none -mb-px rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 pb-3 text-sm font-medium text-text-secondary shadow-none after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none';

export default function SettingsClient({
  teamMembers,
  facility,
  planName,
  inviterRole,
  remainingSeats,
  existingEmails,
}: SettingsClientProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-text-secondary">
          Manage your facility, team access, and account preferences
        </p>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="mb-8 h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="users" className={TAB_TRIGGER_CLASS}>
            Users &amp; Permissions
          </TabsTrigger>
          <TabsTrigger value="roles" className={TAB_TRIGGER_CLASS}>
            Roles
          </TabsTrigger>
          <TabsTrigger value="facility" className={TAB_TRIGGER_CLASS}>
            Facility
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersPermissionsTab members={teamMembers} onInvite={() => setShowInviteModal(true)} />
        </TabsContent>

        <TabsContent value="roles">
          <RolesMatrixTab />
        </TabsContent>

        <TabsContent value="facility">
          <FacilityTab facility={facility} planName={planName} />
        </TabsContent>
      </Tabs>

      <InviteStaffModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        remainingSeats={remainingSeats}
        planName={planName}
        inviterRole={inviterRole}
        existingEmails={existingEmails}
      />
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateStaffDetails } from '@/app/actions/staff';
import { getRoleDisplayName, groupRolesForSelect } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';
import type { EditableStaffMember } from './EditProfileModal';

interface ChangeRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: EditableStaffMember;
  /** Decides which roles are offered — see {@link groupRolesForSelect}. */
  viewerRole: Role;
}

/**
 * Re-roles a staff member in place.
 *
 * Kept apart from {@link EditProfileModal} because the two are not comparable
 * acts: a name correction is routine, a role change rewrites what the person can
 * reach and signs them out. It follows `ChangeFacilityModal`'s select → confirm
 * shape for the same reason.
 *
 * The options come from `groupRolesForSelect(viewerRole)`, which reads
 * `GRANTABLE_ROLES` — the same list `canChangeRole` enforces server-side. So
 * Owner and Admin are genuinely ABSENT from an HR's list rather than offered and
 * then refused (founder answer Q11).
 *
 * ⛔ MOUNT THIS ON DEMAND (`{isOpen && <ChangeRoleModal … />}`) — a fresh mount
 * is what discards a stale draft selection and re-reads the member's role after
 * a sibling affordance's `router.refresh()`.
 */
export default function ChangeRoleModal({
  isOpen,
  onClose,
  member,
  viewerRole,
}: ChangeRoleModalProps) {
  const router = useRouter();
  const roleGroups = useMemo(() => groupRolesForSelect(viewerRole), [viewerRole]);
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [newRole, setNewRole] = useState<Role | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setIsSaving(false);
    onClose();
  };

  const currentRoleName = getRoleDisplayName(member.role);
  const newRoleName = newRole ? getRoleDisplayName(newRole) : '';
  const staffLabel = member.name || member.email;

  const handleConfirm = async () => {
    if (!newRole) return;
    setIsSaving(true);
    setError(null);

    const result = await updateStaffDetails(member.id, {
      role: newRole,
      // Unchanged by design — this affordance only re-roles.
      firstName: member.firstName,
      lastName: member.lastName,
    });

    setIsSaving(false);
    if (result.success) {
      close();
      router.refresh();
    } else {
      // `updateStaffDetails` already maps each `canChangeRole` denial to its own
      // caller-facing sentence; show what it returned rather than a generic
      // failure, and send the admin back to the picker to choose differently.
      setError(result.error ?? 'Failed to change role.');
      setStep('select');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        {step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>Change role</DialogTitle>
              <DialogDescription>
                {staffLabel} is currently a {currentRoleName}. Choose the role they should hold.
              </DialogDescription>
            </DialogHeader>

            <Field label="New role" required>
              <Select value={newRole} onValueChange={(value) => setNewRole(value as Role)}>
                <SelectTrigger id="change-role-select" className="h-11 w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roleGroups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel className="tracking-wide uppercase">{group.label}</SelectLabel>
                      {group.roles.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          // The role they already hold is shown so the list
                          // stays a complete picture of what this admin may
                          // grant, but choosing it would be a no-op.
                          disabled={option.value === member.role}
                        >
                          {option.displayName}
                          {option.value === member.role ? ' (current)' : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter className="grid grid-cols-2 gap-3 sm:flex sm:justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={close}
                className="h-12 w-full border border-[#E4E7EC] bg-white sm:w-[178px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newRole || newRole === member.role}
                onClick={() => {
                  setError(null);
                  setStep('confirm');
                }}
                className="h-12 w-full sm:w-[178px]"
              >
                Change role
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Change &ldquo;{staffLabel}&rdquo; from{' '}
                <span className="text-[#5C47FF]">
                  &ldquo;{currentRoleName}&rdquo; <span className="text-[#202020]">to</span> &ldquo;
                  {newRoleName}&rdquo;?
                </span>
              </DialogTitle>
              <DialogDescription>This takes effect immediately.</DialogDescription>
            </DialogHeader>

            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-text-secondary">
              <li>
                They lose everything {currentRoleName} allows and gain what {newRoleName} allows.
              </li>
              <li>They are signed out of any active session and must sign in again.</li>
              <li>They are enrolled in any training assigned to {newRoleName}.</li>
              <li>Completed courses and certificates stay on their profile.</li>
            </ul>

            {error && <Alert variant="error">{error}</Alert>}

            <DialogFooter className="grid grid-cols-2 gap-3 sm:flex sm:justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={() => setStep('select')}
                disabled={isSaving}
                className="h-12 w-full border border-[#E4E7EC] bg-white sm:w-[178px]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                loading={isSaving}
                className="h-12 w-full sm:w-[178px]"
              >
                Change role
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { updateStaffDetails } from '@/app/actions/staff';
import type { Role } from '@/types/next-auth';

/**
 * The editable half of a staff record, plus the role this modal must echo back
 * unchanged. `id` is the OrganizationUser (membership) id.
 */
export interface EditableStaffMember {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  role: Role;
}

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: EditableStaffMember;
}

/**
 * Edits a staff member's name and job title — the "basic profile editing" a
 * facility supervisor gained under founder answer Q2.
 *
 * `updateStaffDetails` takes name, job title and role together, so this sends
 * the member's CURRENT role back untouched. That is what keeps a supervisor —
 * who reaches the action for profile edits but is not a role-change actor —
 * from tripping its role-change branch at all.
 *
 * ⛔ MOUNT THIS ON DEMAND (`{isOpen && <EditProfileModal … />}`). The fields seed
 * from `member` through `useState` initialisers, so a fresh mount is what
 * re-reads the record after a sibling affordance's `router.refresh()`. Re-syncing
 * a kept-alive instance would need a setState-in-effect, which React Compiler
 * rejects.
 */
export default function EditProfileModal({ isOpen, onClose, member }: EditProfileModalProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(member.firstName);
  const [lastName, setLastName] = useState(member.lastName);
  const [jobTitle, setJobTitle] = useState(member.jobTitle);
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; lastName?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const close = () => {
    setIsSaving(false);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    const nextFieldErrors = {
      ...(trimmedFirst ? {} : { firstName: 'First name is required.' }),
      ...(trimmedLast ? {} : { lastName: 'Last name is required.' }),
    };
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;

    setIsSaving(true);
    setError(null);

    const result = await updateStaffDetails(member.id, {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      jobTitle: jobTitle.trim(),
      // Unchanged by design — this affordance never re-roles anyone.
      role: member.role,
    });

    setIsSaving(false);
    if (result.success) {
      close();
      router.refresh();
    } else {
      setError(result.error ?? 'Failed to update profile.');
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
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update the name and job title on {member.name || member.email}&rsquo;s record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field label="First name" required error={fieldErrors.firstName}>
              <Input
                id="edit-profile-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Last name" required error={fieldErrors.lastName}>
              <Input
                id="edit-profile-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label="Job title"
            helperText="How this person's position is described on their profile and reports."
          >
            <Input
              id="edit-profile-job-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Staff Nurse"
              autoComplete="off"
            />
          </Field>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <DialogFooter className="grid grid-cols-2 gap-3 sm:flex sm:justify-end">
          <Button
            variant="outline"
            type="button"
            onClick={close}
            disabled={isSaving}
            className="h-12 w-full border border-[#E4E7EC] bg-white sm:w-[178px]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            loading={isSaving}
            className="h-12 w-full sm:w-[178px]"
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

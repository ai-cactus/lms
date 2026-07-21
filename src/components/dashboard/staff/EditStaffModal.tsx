'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Alert } from '@/components/ui';
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
import { useRouter } from 'next/navigation';
import { UserRole } from '@/generated/prisma/enums';
import {
  DEFAULT_SELF_SERVE_WORKER_ROLE,
  ROLE_CHANGE_ACTOR_ROLES,
  GRANTABLE_ROLES,
  groupRolesForSelect,
  getRoleDisplayName,
} from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

interface EditStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current admin's role — determines whether the role field is editable. */
  viewerRole: Role;
  /** The current admin's user id — used to block self re-roling. */
  viewerUserId: string;
  staff: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    jobTitle: string;
  };
}

export default function EditStaffModal({
  isOpen,
  onClose,
  viewerRole,
  viewerUserId,
  staff,
}: EditStaffModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>(DEFAULT_SELF_SERVE_WORKER_ROLE);
  const [jobTitle, setJobTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  // The role field is editable only when the viewer may re-role this target:
  // an Owner/Supervisor, acting on someone other than themselves, whose current
  // role is one the viewer can grant (owner is grantable to no one). Mirrors the
  // server's `canChangeRole` guard so the UI never offers a change the server denies.
  const roleFieldEditable =
    ROLE_CHANGE_ACTOR_ROLES.includes(viewerRole) &&
    staff.id !== viewerUserId &&
    GRANTABLE_ROLES[viewerRole].includes(staff.role);

  const roleGroups = useMemo(() => groupRolesForSelect(viewerRole), [viewerRole]);

  const roleReadOnlyReason = !ROLE_CHANGE_ACTOR_ROLES.includes(viewerRole)
    ? "Only an Owner or Supervisor can change a staff member's role."
    : staff.id === viewerUserId
      ? 'You cannot change your own role.'
      : "This person's role can't be changed here.";

  const roleChanged = roleFieldEditable && role !== staff.role;

  useEffect(() => {
    if (isOpen && staff) {
      // Split name into first/last roughly
      const nameParts = staff.name.split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setRole(staff.role);
      setJobTitle(staff.jobTitle || '');
      setMessage(null);
      setErrors({});
    }
  }, [isOpen, staff]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }

    if (!lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateStaffDetails(staff.id, {
        firstName,
        lastName,
        role,
        jobTitle,
      });

      if (result.success) {
        setMessage({ type: 'success', text: 'Staff details updated successfully' });
        setTimeout(() => {
          router.refresh();
          onClose();
        }, 1000);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update' });
      }
    } catch {
      setMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Staff Details</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Field label="First Name" error={errors.firstName} className="flex-1">
              <Input
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (errors.firstName) setErrors((prev) => ({ ...prev, firstName: '' }));
                }}
                placeholder="First Name"
                required
              />
            </Field>
            <Field label="Last Name" error={errors.lastName} className="flex-1">
              <Input
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  if (errors.lastName) setErrors((prev) => ({ ...prev, lastName: '' }));
                }}
                placeholder="Last Name"
                required
              />
            </Field>
          </div>

          <Field label="Email (Read Only)">
            <Input
              value={staff.email}
              disabled
              className="bg-background-secondary text-text-secondary"
            />
          </Field>

          <Field label="Role">
            {roleFieldEditable ? (
              <>
                <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleGroups.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel className="uppercase tracking-wide">{group.label}</SelectLabel>
                        {group.roles.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.displayName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {roleChanged && (
                  <p className="mt-1 text-xs text-warning">
                    Changing this person&apos;s role will sign them out of all active sessions.
                  </p>
                )}
              </>
            ) : (
              <>
                <Input
                  value={getRoleDisplayName(staff.role as Role)}
                  disabled
                  className="bg-background-secondary text-text-secondary"
                />
                <p className="mt-1 text-xs text-text-secondary">{roleReadOnlyReason}</p>
              </>
            )}
          </Field>

          <Field label="Job Title">
            <Input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Direct Support Professional"
            />
          </Field>

          {message && (
            <Alert variant={message.type === 'success' ? 'success' : 'error'}>{message.text}</Alert>
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="default" type="submit" loading={isLoading}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
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
import { updateStaffDetails } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';
import { UserRole } from '@/generated/prisma/enums';

interface EditStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    jobTitle: string;
  };
}

export default function EditStaffModal({ isOpen, onClose, staff }: EditStaffModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<UserRole>('worker');
  const [jobTitle, setJobTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  useEffect(() => {
    if (isOpen && staff) {
      // Split name into first/last roughly
      const nameParts = staff.name.split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setRole(staff.role || 'worker');
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

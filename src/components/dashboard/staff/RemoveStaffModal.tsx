'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui';
import { removeStaff } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';
import { logger } from '@/lib/logger';

interface RemoveStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffId: string;
  staffName: string;
  staffEmail: string;
}

export default function RemoveStaffModal({
  isOpen,
  onClose,
  staffId,
  staffName,
  staffEmail,
}: RemoveStaffModalProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleRemove = async () => {
    setIsRemoving(true);
    setError(null);
    try {
      const result = await removeStaff(staffId);
      if (result.success) {
        onClose();
        router.refresh();
      } else {
        setError(result.error || 'Failed to remove staff member');
      }
    } catch (err) {
      setError('An unexpected error occurred');
      logger.error({ msg: 'Error:', err: err });
    } finally {
      setIsRemoving(false);
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
          <DialogTitle>Remove Staff Member</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove <strong>{staffName || staffEmail}</strong> from your
            organization?
          </DialogDescription>
        </DialogHeader>

        <p className="text-[13px] text-error">
          This action will disconnect the user from your organization. They will no longer be able
          to access assigned courses or your organization&apos;s dashboard.
        </p>
        {error && <Alert variant="error">{error}</Alert>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isRemoving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} loading={isRemoving}>
            Remove Staff
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

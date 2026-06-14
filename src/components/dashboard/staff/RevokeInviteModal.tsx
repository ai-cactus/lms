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
import { revokeInvite } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';

interface RevokeInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteId: string;
  inviteEmail: string;
}

export default function RevokeInviteModal({
  isOpen,
  onClose,
  inviteId,
  inviteEmail,
}: RevokeInviteModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await revokeInvite(inviteId);
      onClose();
      // Refresh the current page to reflect the removed invite
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite.');
      setIsSubmitting(false);
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
          <DialogTitle>Revoke Invite</DialogTitle>
          <DialogDescription>
            Are you sure you want to revoke the pending invite for <strong>{inviteEmail}</strong>?
            They will no longer be able to use the invite link to join your organization.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} loading={isSubmitting}>
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

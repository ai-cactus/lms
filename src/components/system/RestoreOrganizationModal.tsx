'use client';

import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { restoreOrganization } from '@/app/actions/system-admin';
import type { OrganizationRestorePreview } from '@/lib/system/delete-organization';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import CountTable, { type CountRow } from './CountTable';

interface RestoreOrganizationModalProps {
  preview: OrganizationRestorePreview;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function RestoreOrganizationModal({
  preview,
  onClose,
  onSuccess,
}: RestoreOrganizationModalProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const { organization, membersToReactivate, skippedDeletedUsers, seatWarning, blockedReason } =
    preview;

  async function handleRestore() {
    if (blockedReason) return;
    setLoading(true);
    setError('');

    try {
      const result = await restoreOrganization(organization.id);
      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to restore organization');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const rows: CountRow[] = [
    { label: 'Members reactivated', count: membersToReactivate },
    { label: 'Owners after restore', count: preview.ownersAfterRestore },
    { label: 'Deleted users (not reactivated)', count: skippedDeletedUsers },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">Organization restored</DialogTitle>
          <Alert variant="success" title="Organization restored">
            <strong>{organization.name}</strong> restored.
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-5 text-primary" aria-hidden="true" />
            Restore organization
          </DialogTitle>
          <DialogDescription>
            Restoring brings back the {membersToReactivate} members who were active when this
            organization was deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {error && (
            <Alert variant="error" className="w-full">
              {error}
            </Alert>
          )}

          {blockedReason && (
            <Alert variant="error" className="w-full">
              {blockedReason}
            </Alert>
          )}

          {seatWarning && (
            <Alert variant="warning" className="w-full">
              This puts the organization {seatWarning.over} over its plan limit of {seatWarning.max}
              .
            </Alert>
          )}

          <div className="rounded-[10px] bg-background-secondary px-4 py-3">
            <div className="font-semibold text-foreground">{organization.name}</div>
            <div className="text-sm text-text-secondary">{organization.slug}</div>
          </div>

          {rows.length > 0 && <CountTable heading="Restore summary:" rows={rows} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRestore}
            disabled={loading || Boolean(blockedReason)}
            loading={loading}
          >
            Restore organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

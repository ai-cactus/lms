'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hardDeleteUser } from '@/app/actions/system-admin';
import type { UserHardDeletePreview } from '@/lib/system/hard-delete-user';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import CountTable, { type CountRow } from './CountTable';

interface HardDeleteUserModalProps {
  preview: UserHardDeletePreview;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function HardDeleteUserModal({
  preview,
  onClose,
  onSuccess,
}: HardDeleteUserModalProps) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [storageFailures, setStorageFailures] = useState(0);
  const [error, setError] = useState('');

  const { user, destroyed, storageObjects, refusal, organizations, directReports } = preview;
  const emailMatches = confirmEmail === user.email;
  const canSubmit = emailMatches && acknowledged && !refusal && !loading;

  async function handleDelete() {
    if (!canSubmit) return;
    setLoading(true);
    setError('');

    try {
      const result = await hardDeleteUser(user.id, { confirmEmail, acknowledged });
      if (result.success) {
        setStorageFailures(result.storageFailures ?? 0);
        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to permanently delete user');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const destroyedRows: CountRow[] = [
    { label: 'Organization memberships', count: destroyed.memberships },
    { label: 'Enrollments', count: destroyed.enrollments },
    { label: 'Quiz attempts', count: destroyed.quizAttempts },
    { label: 'Certificates', count: destroyed.certificates },
    { label: 'Notifications', count: destroyed.notifications },
    { label: 'Invites to this email', count: destroyed.invites },
    { label: 'Emails sent to this address', count: destroyed.emailMessages },
    {
      label: 'Stored files (avatar folder + certificate PDFs)',
      count: storageObjects.certificatePdfs,
    },
  ];

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">User permanently deleted</DialogTitle>
          <div className="flex flex-col gap-3">
            <Alert variant="success" title="User permanently deleted">
              <strong>{user.email}</strong> permanently deleted. Redirecting...
            </Alert>
            {storageFailures > 0 && (
              <Alert variant="warning">
                {storageFailures} stored file(s) could not be removed. They were recorded for retry.
              </Alert>
            )}
          </div>
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
            <AlertTriangle className="size-5 text-error" aria-hidden="true" />
            Permanently delete user
          </DialogTitle>
          <DialogDescription>
            This permanently removes {user.name}&apos;s account and the records below. There is no
            restore.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {error && (
            <Alert variant="error" className="w-full">
              {error}
            </Alert>
          )}

          {refusal && (
            <Alert variant="error" className="w-full">
              {refusal}
            </Alert>
          )}

          <div className="rounded-[10px] bg-background-secondary px-4 py-3">
            <div className="break-words font-semibold text-foreground">{user.name}</div>
            <div className="break-all text-sm text-text-secondary">{user.email}</div>
          </div>

          {organizations.length > 0 && (
            <p className="text-sm text-text-secondary">
              Member of:{' '}
              <strong className="text-foreground">
                {organizations
                  .map(
                    (organization) =>
                      `${organization.name}${organization.wasOwner ? ' (owner)' : ''}${
                        organization.deleted ? ' (deleted)' : ''
                      }`,
                  )
                  .join(', ')}
              </strong>
            </p>
          )}

          <Alert variant="warning" className="w-full">
            The email address will be free to register again. A new sign-up with {user.email}{' '}
            creates a brand-new account with none of this history.
          </Alert>

          <CountTable heading="Permanently destroyed:" rows={destroyedRows} />

          <p className="text-sm text-error">
            Certificates are compliance records. Once destroyed, their verification links stop
            working.
          </p>

          {directReports > 0 && (
            <p className="text-sm text-text-secondary">
              {directReports} direct report(s) will no longer have a manager.
            </p>
          )}

          <p className="text-sm text-text-secondary">
            Audit-log entries are kept. They contain ids only.
          </p>

          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-error/30 bg-error/5 p-4">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
              disabled={Boolean(refusal)}
              className="mt-0.5"
            />
            <span className="text-sm text-foreground">
              I understand this permanently destroys the records above, including certificates.
            </span>
          </label>

          <Field label="To confirm, type the email address below:" helperText={user.email}>
            <Input
              type="text"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={`Type ${user.email} to confirm`}
              autoComplete="off"
              disabled={Boolean(refusal)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={handleDelete}
            disabled={!canSubmit}
            loading={loading}
          >
            Permanently delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

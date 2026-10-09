'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { deleteOrganization } from '@/app/actions/system-admin';
import type { OrganizationSoftDeletePreview } from '@/lib/system/delete-organization';
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
import CountTable, { type CountRow } from './CountTable';

const CONFIRM_WORD = 'DELETE';

interface DeleteOrganizationModalProps {
  preview: OrganizationSoftDeletePreview;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function DeleteOrganizationModal({
  preview,
  onClose,
  onSuccess,
}: DeleteOrganizationModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const { organization, refusal, members, pendingInvites, subscription, retained } = preview;
  const confirmed = confirmName === organization.name && confirmWord === CONFIRM_WORD;
  const billingActive = subscription !== null && subscription.status !== 'canceled';

  async function handleDelete() {
    if (!confirmed || refusal) return;
    setLoading(true);
    setError('');

    try {
      const result = await deleteOrganization(organization.id, { confirmName, confirmWord });
      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to delete organization');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const revokedRows: CountRow[] = [
    { label: 'Active members (access removed)', count: members.active },
    { label: 'Owners', count: members.owners },
    {
      label: 'Members who keep access to another organization',
      count: members.alsoInOtherLiveOrgs,
    },
    { label: 'Pending invites (unusable while deleted)', count: pendingInvites },
  ].filter((row) => row.count > 0);

  const retainedRows: CountRow[] = [
    { label: 'Courses', count: retained.courses },
    { label: 'Documents', count: retained.documents },
    { label: 'Enrollments', count: retained.enrollments },
    { label: 'Certificates', count: retained.certificates },
    { label: 'Quiz Attempts', count: retained.quizAttempts },
    { label: 'Facilities', count: retained.facilities },
  ].filter((row) => row.count > 0);

  const sharedRows: CountRow[] = [
    { label: 'Enrollments by other organizations', count: preview.usedByOtherOrgs.enrollments },
    { label: 'Offerings in other organizations', count: preview.usedByOtherOrgs.offerings },
    {
      label: 'Certificates held in other organizations',
      count: preview.usedByOtherOrgs.certificates,
    },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">Organization deleted</DialogTitle>
          <Alert variant="success" title="Organization deleted">
            <strong>{organization.name}</strong> deleted. Members can no longer sign in.
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
            <AlertTriangle className="size-5 text-error" aria-hidden="true" />
            Delete organization
          </DialogTitle>
          <DialogDescription>
            This removes everyone&apos;s access to {organization.name}. Courses, documents,
            enrollments, certificates and billing records are retained and can be restored.
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

          {billingActive && (
            <Alert variant="warning" className="w-full">
              This organization has a {subscription.status} subscription. Deleting it does NOT
              cancel billing.
            </Alert>
          )}

          <div className="rounded-[10px] bg-background-secondary px-4 py-3">
            <div className="font-semibold text-foreground">{organization.name}</div>
            <div className="text-sm text-text-secondary">{organization.slug}</div>
          </div>

          {revokedRows.length > 0 && <CountTable heading="Access removed:" rows={revokedRows} />}

          {retainedRows.length > 0 && (
            <CountTable heading="Records retained:" rows={retainedRows} />
          )}

          {sharedRows.length > 0 && (
            <CountTable heading="Used by other organizations (unchanged):" rows={sharedRows} />
          )}

          {!refusal && (
            <>
              <Field label="Type the organization name to confirm:" helperText={organization.name}>
                <Input
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={`Type ${organization.name} to confirm`}
                  autoComplete="off"
                />
              </Field>
              <Field label="Type DELETE to confirm:">
                <Input
                  type="text"
                  value={confirmWord}
                  onChange={(e) => setConfirmWord(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={handleDelete}
            disabled={!confirmed || loading || Boolean(refusal)}
            loading={loading}
          >
            Delete organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

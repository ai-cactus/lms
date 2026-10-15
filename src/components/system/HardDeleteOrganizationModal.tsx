'use client';

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { hardDeleteOrganization } from '@/app/actions/system-admin';
import type { OrganizationHardDeletePreview } from '@/lib/system/hard-delete-organization';
import { ORGANIZATION_DELETE_CONFIRM_WORD } from '@/lib/system/organization-delete-confirm';
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

interface HardDeleteOrganizationModalProps {
  preview: OrganizationHardDeletePreview;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function HardDeleteOrganizationModal({
  preview,
  onClose,
  onSuccess,
}: HardDeleteOrganizationModalProps) {
  const { organization, destroyed, kept, refusal, subscription, canCancelSubscription } = preview;

  const [confirmName, setConfirmName] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  // Pre-checked: silently billing a destroyed organization is the costlier mistake.
  const [cancelSubscription, setCancelSubscription] = useState(canCancelSubscription);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [storageFailures, setStorageFailures] = useState(0);
  const [subscriptionCancelled, setSubscriptionCancelled] = useState(false);
  const [error, setError] = useState('');

  const confirmed =
    confirmName === organization.name && confirmWord === ORGANIZATION_DELETE_CONFIRM_WORD;
  const canSubmit = confirmed && acknowledged && !refusal && !loading;

  async function handleDelete() {
    if (!canSubmit) return;
    setLoading(true);
    setError('');

    try {
      const result = await hardDeleteOrganization(organization.id, {
        confirmName,
        confirmWord,
        acknowledged,
        cancelSubscription: canCancelSubscription && cancelSubscription,
      });
      setSubscriptionCancelled(result.subscriptionCancelled === true);
      if (result.success) {
        setStorageFailures(result.storageFailures ?? 0);
        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to permanently delete organization');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const destroyedRows: CountRow[] = [
    { label: 'Memberships', count: destroyed.memberships },
    { label: 'Facilities', count: destroyed.facilities },
    { label: 'Courses (including archived)', count: destroyed.courses },
    { label: 'Lessons', count: destroyed.lessons },
    { label: 'Documents (including archived)', count: destroyed.documents },
    { label: 'Document versions', count: destroyed.documentVersions },
    { label: 'Enrollments', count: destroyed.enrollments },
    { label: 'Quiz attempts', count: destroyed.quizAttempts },
    { label: 'Certificates', count: destroyed.certificates },
    { label: 'Notifications', count: destroyed.notifications },
    { label: 'Course assignments', count: destroyed.courseAssignments },
    { label: 'Course offerings', count: destroyed.offerings },
    { label: 'Invites', count: destroyed.invites },
    { label: 'Invoices', count: destroyed.invoices },
    { label: 'Course and document categories', count: destroyed.categories },
    { label: 'Emails', count: destroyed.emailMessages },
    { label: 'Notification events', count: destroyed.notificationEvents },
    { label: 'Cycle-summary runs', count: destroyed.cycleSummaryRuns },
    { label: 'Course-generation jobs', count: destroyed.jobs },
    { label: 'Stored files', count: preview.storageObjects },
  ].filter((row) => row.count > 0);

  const keptRows: CountRow[] = [
    { label: 'User accounts', count: kept.users },
    { label: 'Users who keep another organization', count: kept.usersAlsoInOtherOrgs },
    { label: 'Audit-log entries', count: kept.auditLogs },
    { label: 'PHI decisions', count: kept.phiDecisions },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">Organization permanently deleted</DialogTitle>
          <div className="flex flex-col gap-3">
            <Alert variant="success" title="Organization permanently deleted">
              <strong>{organization.name}</strong> permanently deleted. Redirecting...
            </Alert>
            {subscriptionCancelled && (
              <Alert variant="info">The Stripe subscription was cancelled.</Alert>
            )}
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
            Permanently delete organization
          </DialogTitle>
          <DialogDescription>
            This permanently removes {organization.name} and the records below. There is no restore.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {error && (
            <Alert variant="error" className="w-full">
              {error}
              {subscriptionCancelled && ' The Stripe subscription was already cancelled.'}
            </Alert>
          )}

          {refusal && (
            <Alert variant="error" className="w-full">
              {refusal}
            </Alert>
          )}

          <div className="rounded-[10px] bg-background-secondary px-4 py-3">
            <div className="break-words font-semibold text-foreground">{organization.name}</div>
            <div className="break-all text-sm text-text-secondary">{organization.slug}</div>
          </div>

          {destroyedRows.length > 0 && (
            <CountTable heading="Permanently destroyed:" rows={destroyedRows} />
          )}

          <p className="text-sm text-error">
            Certificates are compliance records. Once destroyed, their verification links stop
            working.
          </p>

          {keptRows.length > 0 && <CountTable heading="Kept:" rows={keptRows} />}

          <p className="text-sm text-text-secondary">
            People&apos;s accounts are not deleted. {kept.usersLeftWithoutOrganization} will have no
            organization left; they can be invited again.
          </p>

          <p className="text-sm text-text-secondary">
            Audit-log entries are kept. They contain ids only.
            {kept.stripeCustomer && ' The Stripe customer is kept.'}
          </p>

          {subscription && (
            <div className="flex flex-col gap-3 rounded-[10px] border border-border p-4">
              <div className="text-sm text-foreground">
                Subscription: <span className="capitalize">{subscription.plan}</span>,{' '}
                <span className="capitalize">{subscription.status}</span>
              </div>
              {canCancelSubscription && (
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    checked={cancelSubscription}
                    onCheckedChange={(value) => setCancelSubscription(value === true)}
                    disabled={Boolean(refusal)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm text-foreground">
                      Cancel the Stripe subscription now
                    </span>
                    <span className="text-xs text-text-secondary">
                      Cancels immediately with no refund or final invoice. The Stripe customer is
                      never deleted.
                    </span>
                  </span>
                </label>
              )}
              {canCancelSubscription && !cancelSubscription && (
                <Alert variant="warning" className="w-full">
                  Billing keeps running in Stripe until the subscription is cancelled there.
                </Alert>
              )}
            </div>
          )}

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

          <Field label="Type the organization name to confirm:" helperText={organization.name}>
            <Input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`Type ${organization.name} to confirm`}
              autoComplete="off"
              disabled={Boolean(refusal)}
            />
          </Field>
          <Field label={`Type ${ORGANIZATION_DELETE_CONFIRM_WORD} to confirm:`}>
            <Input
              type="text"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder={ORGANIZATION_DELETE_CONFIRM_WORD}
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

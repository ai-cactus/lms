'use client';

import React, { useState } from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { AlertTriangle } from 'lucide-react';
import { deleteUserWithRelations } from '@/app/actions/system-admin';
import type { DeletePreview } from '@/app/actions/system-admin';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DeleteUserModalProps {
  preview: DeletePreview;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function DeleteUserModal({ preview, onClose, onSuccess }: DeleteUserModalProps) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const emailMatches = confirmEmail === preview.user.email;

  const { user, counts, retained } = preview;

  // The account holds courses or documents in an organization with nobody left
  // to inherit them, so the server will refuse rather than destroy them.
  const blockedOrganizations = retained.organizationsWithoutCustodian;
  const blocked = blockedOrganizations.length > 0;

  async function handleDelete() {
    if (!emailMatches || blocked) return;
    setLoading(true);
    setError('');

    try {
      const result = await deleteUserWithRelations(preview.user.id);
      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to delete user');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const impactRows = [
    { label: 'User Account', count: 1 },
    { label: 'Enrollments', count: counts.enrollments },
    { label: 'Quiz Attempts', count: counts.quizAttempts },
    { label: 'Certificates', count: counts.certificates },
    { label: 'Notifications', count: counts.notifications },
    { label: 'Jobs', count: counts.jobs },
    { label: 'Invites', count: counts.invites },
    { label: 'Verification Tokens', count: counts.verificationTokens },
  ].filter((row) => row.count > 0);

  const retainedRows = [
    { label: 'Courses authored (reassigned)', count: retained.courses },
    { label: 'Documents uploaded (reassigned)', count: retained.documents },
    { label: "Other members' enrollments (untouched)", count: retained.otherEnrollments },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">User deleted</DialogTitle>
          <Alert variant="success" title="User deleted">
            User <strong>{user.email}</strong> has been permanently deleted. Courses and documents
            they authored were reassigned to a surviving member. Redirecting...
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
            Delete User Permanently
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. The account and its own learning history are permanently
            removed; the organization&apos;s courses and documents are kept.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {error && (
            <Alert variant="error" className="w-full">
              {error}
            </Alert>
          )}

          <div className="rounded-[10px] bg-background-secondary px-4 py-3">
            <div className="font-semibold text-foreground">{user.name}</div>
            <div className="text-sm text-text-secondary">{user.email}</div>
            <div className="mt-1">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                  isAdminRole(user.role)
                    ? 'bg-primary/10 text-primary'
                    : 'bg-background-secondary text-text-secondary'
                }`}
              >
                {user.role}
              </span>
            </div>
          </div>

          {blocked && (
            <Alert variant="error" className="w-full">
              This user authored courses or uploaded documents that no one is left to inherit in{' '}
              <strong>{blockedOrganizations.join(', ')}</strong>. Add a member there, or delete the
              organization, before deleting this user.
            </Alert>
          )}

          {counts.certificates > 0 && (
            <Alert variant="warning" className="w-full">
              <strong>{counts.certificates}</strong> certificate(s) belonging to this user are
              compliance records and cannot be recovered once deleted.
            </Alert>
          )}

          <div>
            <h4 className="mb-2 text-sm font-semibold text-foreground">Records to be deleted:</h4>
            <div className="rounded-[10px] border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Record Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impactRows.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-bold">Total Records</TableCell>
                    <TableCell className="text-right font-bold">
                      {impactRows.reduce((sum, row) => sum + row.count, 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {retainedRows.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-foreground">Records kept:</h4>
              <div className="rounded-[10px] border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Record Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retainedRows.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <Field label="To confirm deletion, type the email address below:" helperText={user.email}>
            <Input
              type="text"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={`Type ${user.email} to confirm`}
              autoComplete="off"
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
            disabled={!emailMatches || loading || blocked}
            loading={loading}
          >
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

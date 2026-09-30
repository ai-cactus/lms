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

interface CountRow {
  label: string;
  count: number;
}

function CountTable({ heading, rows }: { heading: string; rows: CountRow[] }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-foreground">{heading}</h4>
      <div className="rounded-[10px] border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Record Type</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-right">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function DeleteUserModal({ preview, onClose, onSuccess }: DeleteUserModalProps) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const emailMatches = confirmEmail === preview.user.email;

  const { user, revoked, retained, blockedReason } = preview;

  async function handleDelete() {
    if (!emailMatches || blockedReason) return;
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

  const revokedRows: CountRow[] = [
    { label: 'Organization memberships (deactivated)', count: revoked.organizations.length },
    { label: 'Pending invites (expired)', count: revoked.pendingInvites },
  ].filter((row) => row.count > 0);

  const retainedRows: CountRow[] = [
    { label: 'Certificates', count: retained.certificates },
    { label: 'Enrollments', count: retained.enrollments },
    { label: 'Quiz Attempts', count: retained.quizAttempts },
    { label: 'Courses authored', count: retained.courses },
    { label: 'Documents uploaded', count: retained.documents },
    { label: 'Direct reports (manager link kept)', count: retained.directReports },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">User deleted</DialogTitle>
          <Alert variant="success" title="User deleted">
            <strong>{user.email}</strong> can no longer sign in to any organization. Their
            certificates, quiz history and completion records are retained. Redirecting...
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
            Delete User
          </DialogTitle>
          <DialogDescription>
            This removes {user.name}&apos;s access to every organization. Certificates, quiz history
            and completion records are retained for compliance and are not deleted.
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

          {revoked.organizations.length > 0 && (
            <p className="text-sm text-text-secondary">
              Access removed from:{' '}
              <strong className="text-foreground">{revoked.organizations.join(', ')}</strong>
            </p>
          )}

          <Alert variant="warning" className="w-full">
            The email address stays reserved: it cannot be used to sign up or accept an invite
            again.
          </Alert>

          {revokedRows.length > 0 && <CountTable heading="Access removed:" rows={revokedRows} />}

          {retainedRows.length > 0 && (
            <CountTable heading="Records retained:" rows={retainedRows} />
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
            disabled={!emailMatches || loading || Boolean(blockedReason)}
            loading={loading}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

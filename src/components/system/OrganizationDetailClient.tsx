'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import {
  getOrganizationDeletePreview,
  getOrganizationRestorePreview,
} from '@/app/actions/system-admin';
import type { SystemOrganizationDetail } from '@/app/actions/system-admin';
import type {
  OrganizationRestorePreview,
  OrganizationSoftDeletePreview,
} from '@/lib/system/delete-organization';
import DeleteOrganizationModal from './DeleteOrganizationModal';
import RestoreOrganizationModal from './RestoreOrganizationModal';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { logger } from '@/lib/logger';

interface OrganizationDetailClientProps {
  organization: SystemOrganizationDetail;
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function OrganizationDetailClient({ organization }: OrganizationDetailClientProps) {
  const router = useRouter();
  const [deletePreview, setDeletePreview] = useState<OrganizationSoftDeletePreview | null>(null);
  const [restorePreview, setRestorePreview] = useState<OrganizationRestorePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function handleDeleteClick() {
    setPreviewLoading(true);
    try {
      const preview = await getOrganizationDeletePreview(organization.id);
      if (preview) setDeletePreview(preview);
    } catch (err) {
      logger.error({ msg: '[system] Failed to load organization delete preview', err });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestoreClick() {
    setPreviewLoading(true);
    try {
      const preview = await getOrganizationRestorePreview(organization.id);
      if (preview) setRestorePreview(preview);
    } catch (err) {
      logger.error({ msg: '[system] Failed to load organization restore preview', err });
    } finally {
      setPreviewLoading(false);
    }
  }

  const activeMembers = organization.members.filter((member) => member.active).length;
  const { subscription } = organization;

  return (
    <>
      <div className="mb-6">
        <Link
          href="/system/organizations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Organizations
        </Link>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-background p-6">
        <div className="text-xl font-bold text-foreground">{organization.name}</div>
        <div className="text-sm text-text-secondary">{organization.slug}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {organization.deletedAt ? (
            <span className="inline-flex rounded-full bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
              Deleted {formatDate(organization.deletedAt)}
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
              Active
            </span>
          )}
          <span className="text-xs text-text-secondary">
            Created {formatDate(organization.createdAt)}
          </span>
        </div>
      </div>

      {organization.deletedAt && (
        <Alert variant="warning" className="mb-6 w-full">
          Deleted on {formatDateTime(organization.deletedAt)}. Members cannot sign in to this
          organization; its records are retained and it can be restored.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-6">
          <h3 className="mb-4 text-base font-semibold text-foreground">Summary</h3>
          <SummaryRow label="Active members" value={activeMembers} />
          <SummaryRow label="All memberships" value={organization.memberTotal} />
          <SummaryRow label="Facilities" value={organization.facilities.length} />
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <h3 className="mb-4 text-base font-semibold text-foreground">Subscription</h3>
          {subscription ? (
            <>
              <SummaryRow
                label="Plan"
                value={<span className="capitalize">{subscription.plan}</span>}
              />
              <SummaryRow
                label="Status"
                value={<span className="capitalize">{subscription.status}</span>}
              />
              <SummaryRow
                label="Current period ends"
                value={formatDate(subscription.currentPeriodEnd)}
              />
              <SummaryRow
                label="Cancels at period end"
                value={subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}
              />
            </>
          ) : (
            <div className="text-sm text-text-tertiary">No subscription</div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Members</h3>
            <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {organization.members.length < organization.memberTotal
                ? `${organization.members.length} of ${organization.memberTotal}`
                : organization.memberTotal}
            </span>
          </div>
          {organization.members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Member</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organization.members.map((member) => (
                  <TableRow key={member.organizationUserId}>
                    <TableCell>
                      <Link
                        href={`/system/users/${member.userId}`}
                        className="block min-w-0 hover:underline"
                      >
                        <div className="truncate font-medium text-foreground">
                          {member.name || member.email}
                        </div>
                        <div className="truncate text-xs text-text-secondary">{member.email}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden capitalize sm:table-cell">{member.role}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {member.userDeletedAt ? (
                        <span className="text-xs font-semibold text-error">User deleted</span>
                      ) : member.active ? (
                        <span className="text-xs font-semibold text-success">Active</span>
                      ) : (
                        <span className="text-xs text-text-secondary">
                          Deactivated
                          {member.deactivatedAt ? ` ${formatDate(member.deactivatedAt)}` : ''}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTableState message="No members" />
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Facilities</h3>
            <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {organization.facilities.length}
            </span>
          </div>
          {organization.facilities.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organization.facilities.map((facility) => (
                  <TableRow key={facility.id}>
                    <TableCell className="font-medium">{facility.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {[facility.city, facility.state].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTableState message="No facilities" />
          )}
        </div>
      </div>

      {organization.deletedAt ? (
        <div className="mt-6 rounded-xl border border-border bg-background p-6">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <RotateCcw className="size-5" aria-hidden="true" />
            Restore
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Bring back the members who were active when this organization was deleted.
          </p>
          <Button
            onClick={handleRestoreClick}
            disabled={previewLoading}
            loading={previewLoading}
            className="mt-4"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Restore This Organization
          </Button>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-error/30 bg-error/10 p-6">
          <div className="flex items-center gap-2 font-semibold text-error">
            <AlertTriangle className="size-5" aria-hidden="true" />
            Danger Zone
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Remove everyone&apos;s access to this organization. Courses, documents, enrollments,
            certificates and billing records are retained and can be restored.
          </p>
          <Button
            variant="destructive"
            onClick={handleDeleteClick}
            disabled={previewLoading}
            loading={previewLoading}
            className="mt-4"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete This Organization
          </Button>
        </div>
      )}

      {deletePreview && (
        <DeleteOrganizationModal
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onSuccess={() => router.refresh()}
        />
      )}

      {restorePreview && (
        <RestoreOrganizationModal
          preview={restorePreview}
          onClose={() => setRestorePreview(null)}
          onSuccess={() => router.refresh()}
        />
      )}
    </>
  );
}

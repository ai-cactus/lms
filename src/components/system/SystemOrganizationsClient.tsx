'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Eye, RotateCcw, Trash2 } from 'lucide-react';
import {
  getAllOrganizations,
  getOrganizationDeletePreview,
  getOrganizationRestorePreview,
} from '@/app/actions/system-admin';
import type {
  SystemOrganizationRow,
  SystemOrganizationStatusFilter,
} from '@/app/actions/system-admin';
import type {
  OrganizationRestorePreview,
  OrganizationSoftDeletePreview,
} from '@/lib/system/delete-organization';
import DeleteOrganizationModal from './DeleteOrganizationModal';
import RestoreOrganizationModal from './RestoreOrganizationModal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RowActionsMenu } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { logger } from '@/lib/logger';

const PAGE_SIZE = 20;

interface SystemOrganizationsClientProps {
  initialOrganizations: SystemOrganizationRow[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SystemOrganizationsClient({
  initialOrganizations,
  initialTotal,
  initialPage,
  initialTotalPages,
}: SystemOrganizationsClientProps) {
  const [organizations, setOrganizations] = useState<SystemOrganizationRow[]>(initialOrganizations);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SystemOrganizationStatusFilter>('active');
  const [loading, setLoading] = useState(false);

  const [deletePreview, setDeletePreview] = useState<OrganizationSoftDeletePreview | null>(null);
  const [restorePreview, setRestorePreview] = useState<OrganizationRestorePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAllOrganizations({
        page,
        limit: PAGE_SIZE,
        search,
        statusFilter,
      });
      setOrganizations(result.organizations);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      logger.error({ msg: '[system] Failed to fetch organizations', err });
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchOrganizations();
  }

  async function handleDeleteClick(organizationId: string) {
    setPreviewLoading(true);
    try {
      const preview = await getOrganizationDeletePreview(organizationId);
      if (preview) setDeletePreview(preview);
    } catch (err) {
      logger.error({ msg: '[system] Failed to load organization delete preview', err });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleRestoreClick(organizationId: string) {
    setPreviewLoading(true);
    try {
      const preview = await getOrganizationRestorePreview(organizationId);
      if (preview) setRestorePreview(preview);
    } catch (err) {
      logger.error({ msg: '[system] Failed to load organization restore preview', err });
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">All Organizations</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage every organization on the platform. {total} matching organizations.
        </p>
      </div>

      <form
        onSubmit={handleSearchSubmit}
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <Input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name or slug..."
          className="h-11 sm:flex-1"
        />
        <select
          aria-label="Organization status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as SystemOrganizationStatusFilter);
            setPage(1);
          }}
          className="h-11 rounded-[10px] border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="active">Active organizations</option>
          <option value="deleted">Deleted organizations</option>
          <option value="all">All organizations</option>
        </select>
      </form>

      <div className="rounded-xl border border-border bg-background">
        {loading && (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-text-secondary">
            <span className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading organizations...
          </div>
        )}

        {!loading && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-0">
                <TableHead>Organization</TableHead>
                <TableHead className="hidden md:table-cell">Members</TableHead>
                <TableHead className="hidden lg:table-cell">Facilities</TableHead>
                <TableHead className="hidden lg:table-cell">Plan</TableHead>
                <TableHead className="hidden xl:table-cell">Created</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.length > 0 ? (
                organizations.map((organization) => (
                  <TableRow key={organization.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {organization.name}
                        </div>
                        <div className="truncate text-xs text-text-secondary">
                          {organization.slug}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {organization.memberCount}
                      <span className="text-xs text-text-secondary">
                        {' '}
                        ({organization.ownerCount}{' '}
                        {organization.ownerCount === 1 ? 'owner' : 'owners'})
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {organization.facilityCount}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {organization.subscription ? (
                        <span className="capitalize">
                          {organization.subscription.plan}{' '}
                          <span className="text-xs text-text-secondary">
                            ({organization.subscription.status})
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-tertiary">None</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {formatDate(organization.createdAt)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {organization.deletedAt ? (
                        <span className="inline-flex rounded-full bg-error/10 px-2.5 py-0.5 text-xs font-semibold text-error">
                          Deleted
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                          Active
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View',
                            icon: <Eye className="size-4" />,
                            href: `/system/organizations/${organization.id}`,
                          },
                          organization.deletedAt
                            ? {
                                label: 'Restore',
                                icon: <RotateCcw className="size-4" />,
                                disabled: previewLoading,
                                onSelect: () => handleRestoreClick(organization.id),
                              }
                            : {
                                label: 'Delete',
                                icon: <Trash2 className="size-4" />,
                                variant: 'destructive' as const,
                                disabled: previewLoading,
                                onSelect: () => handleDeleteClick(organization.id),
                              },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableState
                  message="No organizations found"
                  subMessage="Try adjusting your search or filter criteria."
                  colSpan={7}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>
        )}

        {!loading && totalPages > 1 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
            <div className="text-sm text-text-secondary">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}{' '}
              organizations
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                if (pageNum > totalPages || pageNum < 1) return null;
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>

      {deletePreview && (
        <DeleteOrganizationModal
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onSuccess={fetchOrganizations}
        />
      )}

      {restorePreview && (
        <RestoreOrganizationModal
          preview={restorePreview}
          onClose={() => setRestorePreview(null)}
          onSuccess={fetchOrganizations}
        />
      )}
    </>
  );
}

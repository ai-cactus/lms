'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Eye, Trash2 } from 'lucide-react';
import { getAllUsers, getUserDeletePreview } from '@/app/actions/system-admin';
import type { SystemUserRow, DeletePreview } from '@/app/actions/system-admin';
import DeleteUserModal from './DeleteUserModal';
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

interface SystemUsersClientProps {
  initialUsers: SystemUserRow[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  organizations: { id: string; name: string }[];
}

export default function SystemUsersClient({
  initialUsers,
  initialTotal,
  initialPage,
  initialTotalPages,
  organizations,
}: SystemUsersClientProps) {
  const [users, setUsers] = useState<SystemUserRow[]>(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Delete modal state
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAllUsers({
        page,
        limit: 20,
        search,
        roleFilter,
        orgFilter,
      });
      setUsers(result.users);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      logger.error({ msg: 'Failed to fetch users:', err: err });
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, orgFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  }

  async function handleDeleteClick(userId: string) {
    setDeleteLoading(true);
    try {
      const preview = await getUserDeletePreview(userId);
      if (preview) {
        setDeletePreview(preview);
      }
    } catch (err) {
      logger.error({ msg: 'Failed to load delete preview:', err: err });
    } finally {
      setDeleteLoading(false);
    }
  }

  // Count stats
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const workerCount = users.filter((u) => u.role === 'worker').length;

  function getInitials(user: SystemUserRow): string {
    if (user.profile?.fullName) {
      return user.profile.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email.slice(0, 2).toUpperCase();
  }

  function getDisplayName(user: SystemUserRow): string {
    return user.profile?.fullName || user.email.split('@')[0];
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">All Users</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage all users across all organizations. {total} total users.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[10px] border border-border bg-background p-4">
          <div className="text-2xl font-bold text-foreground">{total}</div>
          <div className="mt-1 text-sm text-text-secondary">Total Users</div>
        </div>
        <div className="rounded-[10px] border border-border bg-background p-4">
          <div className="text-2xl font-bold text-primary">{adminCount}</div>
          <div className="mt-1 text-sm text-text-secondary">Admins (this page)</div>
        </div>
        <div className="rounded-[10px] border border-border bg-background p-4">
          <div className="text-2xl font-bold text-foreground">{workerCount}</div>
          <div className="mt-1 text-sm text-text-secondary">Workers (this page)</div>
        </div>
        <div className="rounded-[10px] border border-border bg-background p-4">
          <div className="text-2xl font-bold text-text-secondary">{organizations.length}</div>
          <div className="mt-1 text-sm text-text-secondary">Organizations</div>
        </div>
      </div>

      {/* Filters */}
      <form
        onSubmit={handleSearchSubmit}
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className="h-11 sm:flex-1"
        />
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-[10px] border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="worker">Worker</option>
        </select>
        <select
          value={orgFilter}
          onChange={(e) => {
            setOrgFilter(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-[10px] border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </form>

      {/* Table */}
      <div className="rounded-xl border border-border bg-background">
        {loading && (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-text-secondary">
            <span className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
            Loading users...
          </div>
        )}

        {!loading && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-0">
                <TableHead>User</TableHead>
                <TableHead className="hidden md:table-cell">Role</TableHead>
                <TableHead className="hidden lg:table-cell">Organization</TableHead>
                <TableHead className="hidden xl:table-cell">Courses</TableHead>
                <TableHead className="hidden xl:table-cell">Enrollments</TableHead>
                <TableHead className="hidden xl:table-cell">Documents</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length > 0 ? (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {getInitials(user)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {getDisplayName(user)}
                          </div>
                          <div className="truncate text-xs text-text-secondary">{user.email}</div>
                          <span className="mt-0.5 block text-xs capitalize text-text-secondary md:hidden">
                            {user.role}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                          user.role === 'admin'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-background-secondary text-text-secondary'
                        }`}
                      >
                        {user.role}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {user.organizationName || <span className="text-text-tertiary">None</span>}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{user._count.courses}</TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {user._count.enrollments}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{user._count.documents}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'View',
                            icon: <Eye className="size-4" />,
                            href: `/system/users/${user.id}`,
                          },
                          {
                            label: 'Delete',
                            icon: <Trash2 className="size-4" />,
                            variant: 'destructive',
                            disabled: deleteLoading,
                            onSelect: () => handleDeleteClick(user.id),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableState
                  message="No users found"
                  subMessage="Try adjusting your search or filter criteria."
                  colSpan={8}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
            <div className="text-sm text-text-secondary">
              Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} users
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

      {/* Delete Modal */}
      {deletePreview && (
        <DeleteUserModal
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onSuccess={fetchUsers}
        />
      )}
    </>
  );
}

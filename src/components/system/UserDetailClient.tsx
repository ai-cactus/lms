'use client';

import React, { useState } from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Trash2 } from 'lucide-react';
import { getUserDeletePreview } from '@/app/actions/system-admin';
import type { SystemUserDetail, DeletePreview } from '@/app/actions/system-admin';
import DeleteUserModal from './DeleteUserModal';
import { Button } from '@/components/ui/button';
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

interface UserDetailClientProps {
  user: SystemUserDetail;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'bg-success/10 text-success';
    case 'draft':
      return 'bg-warning/10 text-warning';
    default:
      return 'bg-background-secondary text-text-secondary';
  }
}

export default function UserDetailClient({ user }: UserDetailClientProps) {
  const router = useRouter();
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteClick() {
    setDeleteLoading(true);
    try {
      const preview = await getUserDeletePreview(user.id);
      if (preview) {
        setDeletePreview(preview);
      }
    } catch (err) {
      logger.error({ msg: 'Failed to load delete preview:', err: err });
    } finally {
      setDeleteLoading(false);
    }
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

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const displayName =
    user.profile?.fullName || user.profile?.firstName
      ? `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim()
      : user.email.split('@')[0];

  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const roleBadgeClass = isAdminRole(user.role)
    ? 'bg-primary/10 text-primary'
    : 'bg-background-secondary text-text-secondary';

  return (
    <>
      <div className="mb-6">
        <Link
          href="/system"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Users
        </Link>
      </div>

      <div className="mb-6 flex flex-col items-start gap-4 rounded-xl border border-border bg-background p-6 sm:flex-row sm:items-center">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold text-foreground">{displayName}</div>
          <div className="text-sm text-text-secondary">{user.email}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${roleBadgeClass}`}
            >
              {user.role}
            </span>
            <span className="inline-flex rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {user.authProvider}
            </span>
            {user.emailVerified ? (
              <span className="inline-flex rounded-md bg-success/10 px-2.5 py-1 text-xs text-success">
                ✓ Verified
              </span>
            ) : (
              <span className="inline-flex rounded-md bg-warning/10 px-2.5 py-1 text-xs text-warning">
                Unverified
              </span>
            )}
            <span className="text-xs text-text-secondary">Joined {formatDate(user.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Organization</h3>
          </div>
          {user.organization ? (
            <div>
              <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
                <span className="text-sm text-text-secondary">Name</span>
                <span className="text-sm font-medium text-foreground">
                  {user.organization.name}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
                <span className="text-sm text-text-secondary">Slug</span>
                <span className="text-sm font-medium text-foreground">
                  {user.organization.slug}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-tertiary">No organization assigned</div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Profile</h3>
          </div>
          {user.profile ? (
            <div>
              {user.profile.jobTitle && (
                <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
                  <span className="text-sm text-text-secondary">Job Title</span>
                  <span className="text-sm font-medium text-foreground">
                    {user.profile.jobTitle}
                  </span>
                </div>
              )}
              {user.profile.companyName && (
                <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
                  <span className="text-sm text-text-secondary">Company</span>
                  <span className="text-sm font-medium text-foreground">
                    {user.profile.companyName}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
                <span className="text-sm text-text-secondary">Last Updated</span>
                <span className="text-sm font-medium text-foreground">
                  {formatDate(user.updatedAt)}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-text-tertiary">No profile created</div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Activity Summary</h3>
          </div>
          <div>
            <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
              <span className="text-sm text-text-secondary">Courses Created</span>
              <span className="text-sm font-medium text-foreground">{user._count.courses}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
              <span className="text-sm text-text-secondary">Enrollments</span>
              <span className="text-sm font-medium text-foreground">{user._count.enrollments}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
              <span className="text-sm text-text-secondary">Documents</span>
              <span className="text-sm font-medium text-foreground">{user._count.documents}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
              <span className="text-sm text-text-secondary">Notifications</span>
              <span className="text-sm font-medium text-foreground">
                {user._count.notifications}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-6 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Courses Created</h3>
            <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {user.courses.length}
            </span>
          </div>
          {user.courses.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Lessons</TableHead>
                  <TableHead className="hidden md:table-cell">Enrollments</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.courses.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className="font-medium">{course.title}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(course.status)}`}
                      >
                        {course.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{course._count.lessons}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {course._count.enrollments}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDate(course.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTableState message="No courses created" />
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Enrollments</h3>
            <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {user.enrollments.length}
            </span>
          </div>
          {user.enrollments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Course</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Progress</TableHead>
                  <TableHead className="hidden lg:table-cell">Score</TableHead>
                  <TableHead className="hidden lg:table-cell">Started</TableHead>
                  <TableHead className="hidden lg:table-cell">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.enrollments.map((enrollment) => (
                  <TableRow key={enrollment.id}>
                    <TableCell className="font-medium">{enrollment.course.title}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadgeClass(enrollment.status)}`}
                      >
                        {enrollment.status}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background-secondary">
                          <div
                            className={`h-full rounded-full ${
                              enrollment.progress === 100 ? 'bg-success' : 'bg-primary'
                            }`}
                            style={{ width: `${enrollment.progress}%` }}
                          />
                        </div>
                        <span className="min-w-8 text-xs text-text-secondary">
                          {enrollment.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {enrollment.score !== null ? `${enrollment.score}%` : '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatDate(enrollment.startedAt)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {enrollment.completedAt ? formatDate(enrollment.completedAt) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTableState message="No enrollments" />
          )}
        </div>

        <div className="rounded-xl border border-border bg-background p-6 md:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Documents</h3>
            <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              {user.documents.length}
            </span>
          </div>
          {user.documents.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-0">
                  <TableHead>Original Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Size</TableHead>
                  <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.originalName}</TableCell>
                    <TableCell className="hidden sm:table-cell">{formatSize(doc.size)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDateTime(doc.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTableState message="No documents" />
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-error/30 bg-error/10 p-6">
        <div className="flex items-center gap-2 font-semibold text-error">
          <AlertTriangle className="size-5" aria-hidden="true" />
          Danger Zone
        </div>
        <p className="mt-2 text-sm text-text-secondary">
          Permanently delete this user and all associated records including courses, enrollments,
          documents, notifications, and profile data. This action cannot be undone.
        </p>
        <Button
          variant="destructive"
          onClick={handleDeleteClick}
          disabled={deleteLoading}
          loading={deleteLoading}
          className="mt-4"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete This User
        </Button>
      </div>

      {deletePreview && (
        <DeleteUserModal
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onSuccess={() => router.push('/system')}
        />
      )}
    </>
  );
}

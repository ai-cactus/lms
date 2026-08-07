'use client';

import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Search,
  Eye,
  FileText,
  UserMinus,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Send,
  Copy,
  Building2,
} from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
import type { AccessibleFacility } from '@/lib/facility/scope';
import type { Role } from '@/types/next-auth';

interface StaffEntry {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  jobTitle: string;
  dateInvited: Date;
  isPending: boolean;
  isExpired: boolean;
  token: string | null;
  /** Active facility assignments; always empty for pending invites. */
  facilities: { id: string; name: string }[];
}

import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';
import InviteStaffModal from './InviteStaffModal';
import RevokeInviteModal from './RevokeInviteModal';
import RemoveStaffModal from './RemoveStaffModal';
import WorkerLimitModal from './WorkerLimitModal';
import ChangeFacilityModal, { type ChangeFacilityMember } from './ChangeFacilityModal';
import { generateStaffActivityPdfAndEmail, resendInvite } from '@/app/actions/staff';

interface StaffListClientProps {
  users: StaffEntry[];
  hasOrganization: boolean;
  organizationId: string;
  planLimit: number | null;
  planName: string;
  currentWorkerCount: number;
  pendingInviteCount: number;
  inviterRole: Role;
  /** Facilities the viewer may move staff into; empty for single-site orgs. */
  facilities: AccessibleFacility[];
}

const tableHeadClass =
  'h-[41px] truncate text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] sm:text-[15.5px]';

export default function StaffListClient({
  users: initialUsers,
  hasOrganization,
  organizationId,
  planLimit,
  planName,
  currentWorkerCount,
  pendingInviteCount,
  inviterRole,
  facilities,
}: StaffListClientProps) {
  // Only roles that actually hold the relevant permission see each affordance;
  // the server still enforces these, this just hides the dead-end UI (e.g. finance
  // and clinical_director, who are view-only over the staff roster).
  const inviterRoleKey = dbRoleToRoleKey(inviterRole);
  const canInvite = can(inviterRoleKey, 'invite.create');
  const canRemoveStaff = can(inviterRoleKey, 'user.delete');
  const canEditInvite = can(inviterRoleKey, 'invite.edit');
  const canDeleteInvite = can(inviterRoleKey, 'invite.delete');
  // Reassigning a facility is a membership edit; with no facilities to move
  // between the action is a dead end, so it is hidden too.
  const canChangeFacility = can(inviterRoleKey, 'user.edit') && facilities.length > 0;

  // Total seats consumed = active workers + pending invites
  const totalUsed = currentWorkerCount + pendingInviteCount;
  const isAtLimit = planLimit !== null && totalUsed >= planLimit;
  const [showFeatureGate, setShowFeatureGate] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showWorkerLimitModal, setShowWorkerLimitModal] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [changeFacilityTarget, setChangeFacilityTarget] = useState<ChangeFacilityMember | null>(
    null,
  );
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  // Export state: tracks which user ID is currently being exported
  const [exportingUserId, setExportingUserId] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);
  // Tracks the invite currently being resent, plus inline feedback for
  // resend/copy-link actions (keyed by the invite row id).
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);

  const filteredUsers = useMemo(() => {
    return initialUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [initialUsers, searchQuery]);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentUsers = filteredUsers.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredUsers.length;

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Show at most 5 page controls, collapsing the middle with an ellipsis.
  const pageNumbers = useMemo<(number | '…')[]>(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 3) return [1, 2, 3, '…', totalPages];
    if (currentPage >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
    return [1, '…', currentPage, '…', totalPages];
  }, [totalPages, currentPage]);

  // Calculate relative time (e.g. "2 days ago")
  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - new Date(date).getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;

    const diffInMonths = Math.floor(diffInDays / 30);
    return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  };

  const openInvite = () => {
    if (isAtLimit) {
      setShowWorkerLimitModal(true);
    } else if (!hasOrganization) {
      setShowFeatureGate(true);
    } else {
      setShowInviteModal(true);
    }
  };

  // Handle Export PDF: generate and email activity report for a staff member
  const handleExportPdf = async (userId: string) => {
    setExportingUserId(userId);
    setExportFeedback(null);
    try {
      const result = await generateStaffActivityPdfAndEmail(userId);
      setExportFeedback({
        id: userId,
        ok: result.success,
        msg: result.success
          ? 'Report emailed to you successfully.'
          : (result.error ?? 'Failed to generate report.'),
      });
    } finally {
      setExportingUserId(null);
      // Auto-clear feedback after 5 s
      setTimeout(() => setExportFeedback(null), 5000);
    }
  };

  // Resend a pending/expired invite — regenerates its token + expiry server-side
  // and refreshes the list so the row reflects the new (unexpired) state.
  const handleResendInvite = async (inviteId: string) => {
    setResendingInviteId(inviteId);
    setInviteFeedback(null);
    try {
      const result = await resendInvite(inviteId);
      setInviteFeedback({
        id: inviteId,
        ok: result.success,
        msg: result.success
          ? 'Invite resent successfully.'
          : (result.error ?? 'Failed to resend invite.'),
      });
      if (result.success) router.refresh();
    } finally {
      setResendingInviteId(null);
      setTimeout(() => setInviteFeedback(null), 5000);
    }
  };

  // Copy the invite's join link to the clipboard for manual sharing.
  const handleCopyInviteLink = async (entry: StaffEntry) => {
    if (!entry.token) return;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    try {
      await navigator.clipboard.writeText(`${baseUrl}/join/${entry.token}`);
      setInviteFeedback({ id: entry.id, ok: true, msg: 'Invite link copied to clipboard.' });
    } catch {
      setInviteFeedback({ id: entry.id, ok: false, msg: 'Could not copy invite link.' });
    }
    setTimeout(() => setInviteFeedback(null), 5000);
  };

  const modals = (
    <>
      <OrganizationActivationModal
        hasOrganization={hasOrganization}
        mode="feature_gate"
        isOpen={showFeatureGate}
        onClose={() => setShowFeatureGate(false)}
      />
      {canInvite && (
        <InviteStaffModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          organizationId={organizationId}
          remainingSeats={planLimit !== null ? Math.max(0, planLimit - totalUsed) : null}
          planName={planName}
          inviterRole={inviterRole}
          existingEmails={initialUsers.map((u) => u.email)}
        />
      )}
      {revokeTarget && (
        <RevokeInviteModal
          isOpen={!!revokeTarget}
          onClose={() => setRevokeTarget(null)}
          inviteId={revokeTarget.id}
          inviteEmail={revokeTarget.email}
        />
      )}

      {removeTarget && (
        <RemoveStaffModal
          isOpen={!!removeTarget}
          onClose={() => setRemoveTarget(null)}
          staffId={removeTarget.id}
          staffName={removeTarget.name}
          staffEmail={removeTarget.email}
        />
      )}

      {changeFacilityTarget && (
        <ChangeFacilityModal
          isOpen={!!changeFacilityTarget}
          onClose={() => setChangeFacilityTarget(null)}
          member={changeFacilityTarget}
          facilities={facilities}
        />
      )}

      <WorkerLimitModal
        isOpen={showWorkerLimitModal}
        onClose={() => setShowWorkerLimitModal(false)}
        planName={planName}
        planLimit={planLimit || 0}
      />
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <header className="mb-[30px] flex flex-col gap-[5px]">
        <div className="flex items-center gap-4">
          <h1 className="min-w-0 flex-1 text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            Staff Details
          </h1>
          {canInvite && (
            <Button
              variant="outline"
              onClick={openInvite}
              className="h-12 shrink-0 gap-2 rounded-xl border-[#d4d4d4] px-5 text-[15.5px] font-semibold text-primary hover:text-primary"
            >
              <UserPlus className="size-[23px]" />
              Add Staff
            </Button>
          )}
        </div>
        <p className="text-sm leading-tight font-medium text-[#a0aec0]">
          Here is an overview of your staff details
        </p>
        {/* Plan seat usage badge — only shown when the org has a capped plan */}
        {planLimit !== null && (
          <p
            className={cn(
              'text-[13px]',
              isAtLimit ? 'font-semibold text-error' : 'text-text-secondary',
            )}
          >
            {isAtLimit ? (
              <>
                ⚠️ Worker limit reached &mdash; {totalUsed}/{planLimit} seats used ({planName}{' '}
                plan).{' '}
                <a href="/dashboard/billing" className="text-primary underline">
                  Upgrade
                </a>{' '}
                to add more.
              </>
            ) : (
              <>
                {totalUsed}/{planLimit} workers used &bull; {planLimit - totalUsed} seat
                {planLimit - totalUsed !== 1 ? 's' : ''} remaining ({planName})
              </>
            )}
          </p>
        )}
      </header>

      {initialUsers.length === 0 ? (
        <div className="flex min-h-[520px] flex-1 flex-col items-center justify-center rounded-[17px] border border-[#dfe1e6] bg-white px-4 py-10 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:min-h-[700px] md:px-[21px]">
          <div className="flex w-full max-w-[482px] flex-col items-center gap-5">
            <Image
              src="/images/courses-empty-state.svg"
              alt=""
              width={226}
              height={226}
              aria-hidden="true"
              className="size-[170px] md:size-[226px]"
            />
            <div className="flex flex-col gap-[5px] text-center">
              <p className="text-[20px] leading-[1.32] font-semibold text-[#11181c] md:text-[24.5px]">
                No staff added yet
              </p>
              <p className="text-[15px] leading-[1.45] text-[#475367] md:text-[16px]">
                Invite your managers and workers to get started. You&apos;ll assign courses and
                track their training progress right from this list.
              </p>
            </div>
            {canInvite && (
              <Button
                size="lg"
                onClick={openInvite}
                className="h-12 rounded-[12px] px-6 text-[15.5px] font-semibold tracking-[-0.31px]"
              >
                Add your first staff
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-[17px] bg-white pt-[21px] pb-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)]">
          <div className="mb-6 w-full sm:ml-auto sm:w-[470px]">
            <Input
              className="h-[38px] rounded-[8px] border-[#dfe1e6] pl-9 text-[15px] placeholder:text-[#a4abb8]"
              type="search"
              placeholder="Search for staff..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Search staff"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>

          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent border-0">
                <TableHead
                  className={cn(tableHeadClass, 'w-full rounded-l-[9px] px-3 sm:w-auto sm:px-6')}
                >
                  Name
                </TableHead>
                {/* Role and Date collapse away on phones — the mobile design keeps
                    only the identity column and the row menu. */}
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'hidden sm:table-cell sm:w-[180px] sm:px-5 xl:w-[276px]',
                  )}
                >
                  Role
                </TableHead>
                <TableHead className={cn(tableHeadClass, 'hidden px-5 lg:table-cell lg:w-[190px]')}>
                  Facility
                </TableHead>
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'hidden px-5 sm:table-cell sm:w-[170px] lg:w-[200px]',
                  )}
                >
                  Date Invited
                </TableHead>
                {/* Kebab column — intentionally unlabelled, matching the design */}
                <TableHead
                  className={cn(tableHeadClass, 'w-[56px] rounded-r-[9px] px-0 sm:w-[70px]')}
                >
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentUsers.length > 0 ? (
                currentUsers.map((user) => (
                  <TableRow
                    key={user.id}
                    onClick={() => !user.isPending && router.push(`/dashboard/staff/${user.id}`)}
                    className={cn(
                      'h-[71px]',
                      user.isPending ? 'cursor-default opacity-85' : 'cursor-pointer',
                    )}
                  >
                    <TableCell className="px-3 py-0 sm:px-6">
                      <div className="flex items-center gap-3">
                        {/* Presence dot lives on the outer wrapper — the inner circle
                            clips its own overflow to keep the avatar image round. */}
                        <div className="relative size-10 shrink-0">
                          <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-[#f1f5f9] text-[#666d80]">
                            {user.avatarUrl ? (
                              <Image
                                src={user.avatarUrl}
                                alt=""
                                width={40}
                                height={40}
                                className="size-full object-cover"
                              />
                            ) : (
                              <span className="text-[15px] font-semibold">
                                {(user.name.charAt(0) || user.email.charAt(0)).toUpperCase()}
                              </span>
                            )}
                          </div>
                          {!user.isPending && (
                            <span
                              aria-hidden="true"
                              className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-white bg-success"
                            />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="flex items-center gap-2 truncate text-[14px] font-semibold tracking-[0.31px] text-[#0d0d12] sm:text-[15.5px]">
                            <span className="truncate">{user.name || user.email}</span>
                            {user.isPending &&
                              (user.isExpired ? (
                                <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-warning">
                                  Expired
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-primary">
                                  Pending
                                </span>
                              ))}
                          </span>
                          <span className="truncate text-[12px] font-normal tracking-[0.27px] text-[#666d80] sm:text-[13.5px]">
                            {user.email}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden py-0 sm:table-cell sm:px-5">
                      <span
                        title={getRoleDisplayName(user.role as Role)}
                        className="inline-flex h-[29px] max-w-full items-center truncate rounded-full bg-[#dcfce7] px-2 text-[12px] font-semibold text-[#15803d] sm:px-[14px] sm:text-[13px]"
                      >
                        {getRoleDisplayName(user.role as Role)}
                      </span>
                    </TableCell>

                    <TableCell className="hidden px-5 py-0 lg:table-cell">
                      {user.facilities.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-[14px] font-medium text-[#0d0d12]">
                          <span className="truncate" title={user.facilities[0].name}>
                            {user.facilities[0].name}
                          </span>
                          {user.facilities.length > 1 && (
                            <span
                              className="shrink-0 rounded-full bg-[#f1f5f9] px-1.5 py-0.5 text-[11px] font-semibold text-[#475367]"
                              title={user.facilities
                                .slice(1)
                                .map((f) => f.name)
                                .join(', ')}
                            >
                              +{user.facilities.length - 1}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[14px] font-medium text-[#a4abb8]">&mdash;</span>
                      )}
                    </TableCell>

                    {/* Date cell — hidden on small screens */}
                    <TableCell className="hidden px-5 py-0 text-[15.5px] font-medium whitespace-nowrap text-[#666d80] sm:table-cell">
                      {getRelativeTime(user.dateInvited)}
                      {exportFeedback?.id === user.id && (
                        <span
                          className={cn(
                            'mt-1 block text-[11px] font-medium',
                            exportFeedback.ok ? 'text-success' : 'text-error',
                          )}
                        >
                          {exportFeedback.msg}
                        </span>
                      )}
                      {inviteFeedback?.id === user.id && (
                        <span
                          className={cn(
                            'mt-1 block text-[11px] font-medium',
                            inviteFeedback.ok ? 'text-success' : 'text-error',
                          )}
                        >
                          {inviteFeedback.msg}
                        </span>
                      )}
                    </TableCell>

                    {/* Kebab action cell — actions are permission-gated; view-only
                        roles (finance, clinical_director) see no mutating actions. */}
                    <TableCell
                      className="px-0 py-0 text-right sm:pr-[19px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const actions: RowAction[] = user.isPending
                          ? [
                              ...(canEditInvite
                                ? [
                                    {
                                      label:
                                        resendingInviteId === user.id
                                          ? 'Resending…'
                                          : 'Resend Invite',
                                      icon: <Send className="size-4" />,
                                      disabled: resendingInviteId === user.id,
                                      onSelect: () => handleResendInvite(user.id),
                                    },
                                    {
                                      label: 'Copy invite link',
                                      icon: <Copy className="size-4" />,
                                      disabled: !user.token,
                                      onSelect: () => handleCopyInviteLink(user),
                                    },
                                  ]
                                : []),
                              ...(canDeleteInvite
                                ? [
                                    {
                                      label: 'Revoke Invite',
                                      icon: <XCircle className="size-4" />,
                                      variant: 'destructive' as const,
                                      separatorBefore: canEditInvite,
                                      onSelect: () =>
                                        setRevokeTarget({ id: user.id, email: user.email }),
                                    },
                                  ]
                                : []),
                            ]
                          : [
                              {
                                label: 'View Profile',
                                icon: <Eye className="size-4" />,
                                onSelect: () => router.push(`/dashboard/staff/${user.id}`),
                              },
                              {
                                label: exportingUserId === user.id ? 'Exporting…' : 'Export PDF',
                                icon: <FileText className="size-4" />,
                                disabled: exportingUserId === user.id,
                                onSelect: () => handleExportPdf(user.id),
                              },
                              ...(canChangeFacility
                                ? [
                                    {
                                      label: 'Change Facility',
                                      icon: <Building2 className="size-4" />,
                                      onSelect: () =>
                                        setChangeFacilityTarget({
                                          id: user.id,
                                          name: user.name,
                                          email: user.email,
                                          avatarUrl: user.avatarUrl,
                                          currentFacilityName: user.facilities[0]?.name ?? null,
                                        }),
                                    },
                                  ]
                                : []),
                              ...(canRemoveStaff
                                ? [
                                    {
                                      label: 'Remove Staff',
                                      icon: <UserMinus className="size-4" />,
                                      variant: 'destructive' as const,
                                      separatorBefore: true,
                                      onSelect: () =>
                                        setRemoveTarget({
                                          id: user.id,
                                          name: user.name,
                                          email: user.email,
                                        }),
                                    },
                                  ]
                                : []),
                            ];
                        return actions.length > 0 ? (
                          <RowActionsMenu
                            className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                            actions={actions}
                          />
                        ) : null;
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableState
                  message="No staff match your search."
                  subMessage="Try a different name or email."
                  colSpan={5}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>

          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
            <span className="text-xs font-medium tracking-[-0.36px] text-[#9a9a9a]">
              Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
              {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
            </span>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {pageNumbers.map((page, i) =>
                page === '…' ? (
                  <span
                    key={`ellipsis-${i}`}
                    className="flex size-10 items-center justify-center text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={page === currentPage ? 'default' : 'ghost'}
                    size="icon-sm"
                    className="size-10 rounded-[8px] text-xs font-medium tracking-[-0.36px] data-[variant=ghost]:text-[#1c1c1c]"
                    onClick={() => handlePageChange(page)}
                    aria-current={page === currentPage ? 'page' : undefined}
                  >
                    {page}
                  </Button>
                ),
              )}

              <Button
                variant="outline"
                size="icon-sm"
                className="size-10 rounded-[8px] border-[#d9d9d9] bg-white"
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => handlePageChange(currentPage + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>

            <div className="flex items-center gap-3 text-xs font-medium tracking-[-0.36px] text-[#1c1c1c]">
              Show
              <Select
                value={itemsPerPage.toString()}
                onValueChange={(value) => {
                  setItemsPerPage(Number(value));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[66px] rounded-[8px] border-[#d9d9d9] px-3 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
              entries
            </div>
          </div>
        </div>
      )}

      {modals}
    </div>
  );
}

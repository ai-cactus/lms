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
  UserMinus,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Send,
  Copy,
  Building2,
} from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { cn, formatRelativeTime } from '@/lib/utils';
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
import { resendInvite } from '@/app/actions/staff';

interface StaffListClientProps {
  users: StaffEntry[];
  hasOrganization: boolean;
  organizationId: string;
  planLimit: number | null;
  planName: string;
  currentWorkerCount: number;
  pendingInviteCount: number;
  inviterRole: Role;
  /** The viewer's own membership id — their row never offers Remove Staff. */
  viewerOrganizationUserId: string | null;
  /** Facilities the viewer may move staff into; empty for single-site orgs. */
  facilities: AccessibleFacility[];
}

const tableHeadClass =
  'h-[41px] truncate text-[13px] font-medium tracking-[0.31px] whitespace-nowrap text-[#666d80] sm:text-[15.5px]';

/** Sentinel value for the role filter's "All Staff" option — never a real `Role`. */
const ALL_ROLES_FILTER = 'all';

export default function StaffListClient({
  users: initialUsers,
  hasOrganization,
  organizationId,
  planLimit,
  planName,
  currentWorkerCount,
  pendingInviteCount,
  inviterRole,
  viewerOrganizationUserId,
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
  const [roleFilter, setRoleFilter] = useState<string>(ALL_ROLES_FILTER);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  // Tracks the invite currently being resent, plus inline feedback for
  // resend/copy-link actions (keyed by the invite row id).
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);

  // Only roles actually present in the roster are offered, so the filter can
  // never resolve to an empty list the viewer cannot explain.
  const roleOptions = useMemo(() => {
    const byRole = new Map<string, string>();
    for (const user of initialUsers) {
      if (!byRole.has(user.role)) byRole.set(user.role, getRoleDisplayName(user.role as Role));
    }
    return [...byRole]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [initialUsers]);

  // A refresh can retire the selected role (last holder removed/re-roled);
  // falling back to "All Staff" keeps the trigger from rendering blank.
  const activeRoleFilter = roleOptions.some((option) => option.value === roleFilter)
    ? roleFilter
    : ALL_ROLES_FILTER;

  const filteredUsers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return initialUsers.filter(
      (user) =>
        (activeRoleFilter === ALL_ROLES_FILTER || user.role === activeRoleFilter) &&
        (user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query)),
    );
  }, [initialUsers, searchQuery, activeRoleFilter]);

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

  const openInvite = () => {
    if (isAtLimit) {
      setShowWorkerLimitModal(true);
    } else if (!hasOrganization) {
      setShowFeatureGate(true);
    } else {
      setShowInviteModal(true);
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
          facilities={facilities}
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
              onClick={openInvite}
              className="h-12 shrink-0 gap-2 rounded-xl px-5 text-[15.5px] font-semibold"
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
        <div className="flex min-w-0 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white p-4 shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] md:px-[21px] md:pt-[21px] md:pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full lg:max-w-[470px]">
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

            <Select
              value={activeRoleFilter}
              onValueChange={(value) => {
                setRoleFilter(value);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Filter by role"
                // min-w-0 on the value span is load-bearing: without it the flex
                // child's min-width:auto lets a long role label push past the
                // fixed trigger width instead of truncating.
                className="h-[38px] w-full rounded-[8px] border-[#dfe1e6] px-4 text-[15px] text-[#0d0d12] *:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate lg:w-[200px] lg:shrink-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ROLES_FILTER}>All Staff</SelectItem>
                {roleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    only the identity column and the row menu. Between lg and xl
                    the shell's 280px sidebar leaves too little room for all five
                    columns, so Date Added (the least actionable of them) drops
                    out there rather than starving Name down to its avatar. From
                    xl up the five share the table proportionally (the design's
                    ratios) instead of by fixed px, so none starves the others. */}
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'hidden sm:table-cell sm:w-[150px] sm:px-5 xl:w-[17%]',
                  )}
                >
                  Role
                </TableHead>
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'hidden px-5 lg:table-cell lg:w-[150px] xl:w-[17%]',
                  )}
                >
                  Facility
                </TableHead>
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'hidden px-5 sm:table-cell sm:w-[140px] lg:hidden xl:table-cell xl:w-[15%]',
                  )}
                >
                  Date Added
                </TableHead>
                <TableHead
                  className={cn(
                    tableHeadClass,
                    'w-[56px] rounded-r-[9px] px-0 text-right sm:w-[70px] sm:pr-[19px] xl:w-[10%] xl:pr-[19px]',
                  )}
                >
                  Action
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
                          {/* Resend/copy feedback rides the identity column —
                              it is the only cell shown at every breakpoint. */}
                          {inviteFeedback?.id === user.id && (
                            <span
                              className={cn(
                                'text-[11px] font-medium',
                                inviteFeedback.ok ? 'text-success' : 'text-error',
                              )}
                            >
                              {inviteFeedback.msg}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden py-0 sm:table-cell sm:px-5">
                      <span
                        title={getRoleDisplayName(user.role as Role)}
                        className="inline-flex h-[29px] max-w-full items-center rounded-full bg-[#dcfce7] px-2 text-[12px] font-semibold text-[#15803d] sm:px-[14px] sm:text-[13px]"
                      >
                        {/* Ellipsis needs its own block — text-overflow never
                            applies to a flex container's anonymous text item. */}
                        <span className="truncate">{getRoleDisplayName(user.role as Role)}</span>
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

                    <TableCell className="hidden px-5 py-0 text-[15.5px] font-medium whitespace-nowrap text-[#666d80] sm:table-cell lg:hidden xl:table-cell">
                      {formatRelativeTime(user.dateInvited)}
                    </TableCell>

                    {/* Action cell — the kebab's actions are permission-gated;
                        view-only roles (finance, clinical_director) see no
                        mutating actions and therefore no kebab at all. */}
                    <TableCell
                      className="px-0 py-0 sm:pr-[19px]"
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
                              // The owner row is immutable for everyone: no
                              // facility reassignment and no removal (the
                              // server rejects both independently).
                              ...(canChangeFacility && user.role !== 'owner'
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
                              ...(canRemoveStaff &&
                              user.id !== viewerOrganizationUserId &&
                              user.role !== 'owner'
                                ? [
                                    {
                                      label: 'Remove Staff',
                                      icon: <UserMinus className="size-4" />,
                                      variant: 'destructive' as const,
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
                        return (
                          <div className="flex items-center justify-end gap-2">
                            {actions.length > 0 && (
                              <RowActionsMenu
                                className="size-8 rounded-[8px] border border-[#ece4e4] bg-white text-[#0d0d12] [&_svg]:size-4"
                                actions={actions}
                              />
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableState
                  message="No staff match your search."
                  subMessage="Try a different name, email, or role."
                  colSpan={5}
                  asTableRow
                />
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
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

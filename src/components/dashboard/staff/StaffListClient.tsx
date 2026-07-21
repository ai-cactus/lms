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
  Users,
  Send,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey, getRoleDisplayName } from '@/lib/rbac/role-utils';
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
}

import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';
import InviteStaffModal from './InviteStaffModal';
import RevokeInviteModal from './RevokeInviteModal';
import RemoveStaffModal from './RemoveStaffModal';
import WorkerLimitModal from './WorkerLimitModal';
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
}

export default function StaffListClient({
  users: initialUsers,
  hasOrganization,
  organizationId,
  planLimit,
  planName,
  currentWorkerCount,
  pendingInviteCount,
  inviterRole,
}: StaffListClientProps) {
  // Only roles that actually hold the relevant permission see each affordance;
  // the server still enforces these, this just hides the dead-end UI (e.g. finance
  // and clinical_director, who are view-only over the staff roster).
  const inviterRoleKey = dbRoleToRoleKey(inviterRole);
  const canInvite = can(inviterRoleKey, 'invite.create');
  const canRemoveStaff = can(inviterRoleKey, 'user.delete');
  const canEditInvite = can(inviterRoleKey, 'invite.edit');
  const canDeleteInvite = can(inviterRoleKey, 'invite.delete');

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

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <div className="mb-6 flex items-start justify-between gap-4 max-sm:flex-col">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-foreground">Staff Details</h1>
          <p className="text-sm text-text-secondary">Here is an overview of your staff details</p>
          {/* Plan seat usage badge — only shown when the org has a capped plan */}
          {planLimit !== null && (
            <p
              className={cn(
                'mt-1 text-[13px]',
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
        </div>
        {canInvite && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isAtLimit) {
                setShowWorkerLimitModal(true);
              } else if (!hasOrganization) {
                setShowFeatureGate(true);
              } else {
                setShowInviteModal(true);
              }
            }}
          >
            <UserPlus className="size-4" />
            Add Workers
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-6">
        <div className="mb-6 w-full sm:w-[380px]">
          <Input
            className="h-11"
            placeholder="Search for staff..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className="pl-12">Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell text-right pr-12">Date Invited</TableHead>
              <TableHead className="w-12 text-right pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentUsers.length > 0 ? (
              currentUsers.map((user) => (
                <TableRow
                  key={user.id}
                  onClick={() => !user.isPending && router.push(`/dashboard/staff/${user.id}`)}
                  className={user.isPending ? 'cursor-default opacity-85' : 'cursor-pointer'}
                >
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-3">
                      <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background-secondary text-text-secondary">
                        {user.avatarUrl ? (
                          <Image
                            src={user.avatarUrl}
                            alt={user.name}
                            width={32}
                            height={32}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-sm font-semibold">
                            {(user.name.charAt(0) || user.email.charAt(0)).toUpperCase()}
                          </div>
                        )}
                        {!user.isPending && (
                          <div className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-background bg-success"></div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 font-semibold text-foreground">
                          {user.email}
                          {user.isPending &&
                            (user.isExpired ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xl bg-warning/10 text-warning tracking-wide">
                                Expired
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xl bg-primary/10 text-primary tracking-wide">
                                Pending
                              </span>
                            ))}
                        </div>
                        <div className="text-xs text-text-secondary">{user.jobTitle}</div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                      {getRoleDisplayName(user.role as Role)}
                    </span>
                  </TableCell>

                  {/* Date cell — hidden on small screens */}
                  <TableCell className="hidden sm:table-cell text-right text-text-secondary pr-6 whitespace-nowrap">
                    {getRelativeTime(user.dateInvited)}
                    {exportFeedback?.id === user.id && (
                      <div
                        className={`mt-1 text-[11px] font-medium ${
                          exportFeedback.ok ? 'text-success' : 'text-error'
                        }`}
                      >
                        {exportFeedback.msg}
                      </div>
                    )}
                    {inviteFeedback?.id === user.id && (
                      <div
                        className={`mt-1 text-[11px] font-medium ${
                          inviteFeedback.ok ? 'text-success' : 'text-error'
                        }`}
                      >
                        {inviteFeedback.msg}
                      </div>
                    )}
                  </TableCell>

                  {/* Kebab action cell — actions are permission-gated; view-only
                      roles (finance, clinical_director) see no mutating actions. */}
                  <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
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
                      return actions.length > 0 ? <RowActionsMenu actions={actions} /> : null;
                    })()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center p-[60px] text-text-secondary">
                  <div className="flex flex-col items-center gap-3">
                    <Users className="size-16 text-text-secondary/40" />
                    <p className="text-base font-semibold text-foreground">
                      No staff members found
                    </p>
                    <p className="text-sm text-text-secondary">
                      Get started by adding a new staff member to your organization.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <div className="text-sm text-text-secondary">
            Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
            {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? 'default' : 'outline'}
                size="icon-sm"
                onClick={() => handlePageChange(page)}
              >
                {page}
              </Button>
            ))}

            <Button
              variant="outline"
              size="icon-sm"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-sm text-text-secondary">
            Show
            <Select
              value={itemsPerPage.toString()}
              onValueChange={(value) => {
                setItemsPerPage(Number(value));
                setCurrentPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-[72px]">
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

      <WorkerLimitModal
        isOpen={showWorkerLimitModal}
        onClose={() => setShowWorkerLimitModal(false)}
        planName={planName}
        planLimit={planLimit || 0}
      />
    </div>
  );
}

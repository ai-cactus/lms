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
import { RowActionsMenu } from '@/components/ui';
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
  Plus,
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
}

export default function StaffListClient({
  users: initialUsers,
  hasOrganization,
  organizationId,
  planLimit,
  planName,
  currentWorkerCount,
  pendingInviteCount,
}: StaffListClientProps) {
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

  // Filter Logic
  const filteredUsers = useMemo(() => {
    return initialUsers.filter(
      (user) =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [initialUsers, searchQuery]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentUsers = filteredUsers.slice(startIndex, startIndex + itemsPerPage);
  const totalEntries = filteredUsers.length;

  // Handle Page Change
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
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 max-sm:flex-col">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-[#1a202c]">Staff Details</h1>
          <p className="text-sm text-[#718096]">Here is an overview of your staff details</p>
          {/* Plan seat usage badge — only shown when the org has a capped plan */}
          {planLimit !== null && (
            <p
              className={cn(
                'mt-1 text-[13px]',
                isAtLimit ? 'font-semibold text-[#C53030]' : 'text-[#718096]',
              )}
            >
              {isAtLimit ? (
                <>
                  ⚠️ Worker limit reached &mdash; {totalUsed}/{planLimit} seats used ({planName}{' '}
                  plan).{' '}
                  <a href="/dashboard/billing" className="text-[#3182CE] underline">
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
          <Plus className="size-4" />
          Add Worker
        </Button>
      </div>

      {/* Content Card */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
        {/* Search */}
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

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className="pl-12">Name</TableHead>
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
                  {/* Name / avatar cell */}
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-3">
                      <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e2e8f0] text-[#4a5568]">
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
                          <div className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-green-500"></div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 font-semibold text-[#1a202c]">
                          {user.email}
                          {user.isPending &&
                            (user.isExpired ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xl bg-[#FFFAF0] text-[#DD6B20] tracking-wide">
                                Expired
                              </span>
                            ) : (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xl bg-[#EBF4FF] text-[#3182CE] tracking-wide">
                                Pending
                              </span>
                            ))}
                        </div>
                        <div className="text-xs text-[#718096]">{user.jobTitle}</div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Date cell — hidden on small screens */}
                  <TableCell className="hidden sm:table-cell text-right text-slate-500 pr-6 whitespace-nowrap">
                    {getRelativeTime(user.dateInvited)}
                    {/* Inline feedback for this row */}
                    {exportFeedback?.id === user.id && (
                      <div
                        className={`mt-1 text-[11px] font-medium ${
                          exportFeedback.ok ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {exportFeedback.msg}
                      </div>
                    )}
                    {inviteFeedback?.id === user.id && (
                      <div
                        className={`mt-1 text-[11px] font-medium ${
                          inviteFeedback.ok ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {inviteFeedback.msg}
                      </div>
                    )}
                  </TableCell>

                  {/* Kebab action cell — always visible */}
                  <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu
                      actions={
                        user.isPending
                          ? [
                              {
                                label:
                                  resendingInviteId === user.id ? 'Resending…' : 'Resend Invite',
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
                              {
                                label: 'Revoke Invite',
                                icon: <XCircle className="size-4" />,
                                variant: 'destructive',
                                separatorBefore: true,
                                onSelect: () => setRevokeTarget({ id: user.id, email: user.email }),
                              },
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
                              {
                                label: 'Remove Staff',
                                icon: <UserMinus className="size-4" />,
                                variant: 'destructive',
                                separatorBefore: true,
                                onSelect: () =>
                                  setRemoveTarget({
                                    id: user.id,
                                    name: user.name,
                                    email: user.email,
                                  }),
                              },
                            ]
                      }
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="text-center p-[60px] text-slate-500">
                  <div className="flex flex-col items-center gap-3">
                    <Users className="size-16 text-slate-300" />
                    <p className="text-base font-semibold text-[#2D3748]">No staff members found</p>
                    <p className="text-sm text-slate-500">
                      Get started by adding a new staff member to your organization.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[#edf2f7] pt-4">
          <div className="text-sm text-[#718096]">
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

          <div className="flex items-center gap-2 text-sm text-[#718096]">
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

      {/* Feature Gate Modal */}
      <OrganizationActivationModal
        hasOrganization={hasOrganization}
        mode="feature_gate"
        isOpen={showFeatureGate}
        onClose={() => setShowFeatureGate(false)}
      />
      {/* Invite Staff Modal */}
      <InviteStaffModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        organizationId={organizationId}
        remainingSeats={planLimit !== null ? Math.max(0, planLimit - totalUsed) : null}
        planName={planName}
        existingEmails={initialUsers.map((u) => u.email)}
      />
      {/* Revoke Invite Modal */}
      {revokeTarget && (
        <RevokeInviteModal
          isOpen={!!revokeTarget}
          onClose={() => setRevokeTarget(null)}
          inviteId={revokeTarget.id}
          inviteEmail={revokeTarget.email}
        />
      )}

      {/* Remove Staff Modal */}
      {removeTarget && (
        <RemoveStaffModal
          isOpen={!!removeTarget}
          onClose={() => setRemoveTarget(null)}
          staffId={removeTarget.id}
          staffName={removeTarget.name}
          staffEmail={removeTarget.email}
        />
      )}

      {/* Worker Limit Modal */}
      <WorkerLimitModal
        isOpen={showWorkerLimitModal}
        onClose={() => setShowWorkerLimitModal(false)}
        planName={planName}
        planLimit={planLimit || 0}
      />
    </div>
  );
}

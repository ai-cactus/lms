'use client';

import React, { useState, useMemo } from 'react';
import styles from './StaffList.module.css';
import { Button, Input, Select } from '@/components/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface StaffEntry {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  jobTitle: string;
  dateInvited: Date;
  isPending: boolean;
}

import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';
import InviteStaffModal from './InviteStaffModal';
import RevokeInviteModal from './RevokeInviteModal';
import RemoveStaffModal from './RemoveStaffModal';
import WorkerLimitModal from './WorkerLimitModal';
import { generateStaffActivityPdfAndEmail } from '@/app/actions/staff';

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

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>Staff Details</h1>
          <p className={styles.subtitle}>Here is an overview of your staff details</p>
          {/* Plan seat usage badge — only shown when the org has a capped plan */}
          {planLimit !== null && (
            <p
              className="mt-1 text-[13px]"
              style={{
                color: isAtLimit ? '#C53030' : '#718096',
                fontWeight: isAtLimit ? 600 : 400,
              }}
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Worker
        </Button>
      </div>

      {/* Content Card */}
      <div className={styles.card}>
        {/* Search */}
        <div className={styles.searchContainer}>
          <Input
            placeholder="Search for staff..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            leftIcon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-slate-400"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            }
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
                  className={user.isPending ? 'cursor-default opacity-85' : styles.clickableRow}
                >
                  {/* Name / avatar cell */}
                  <TableCell className="pl-6">
                    <div className={styles.userInfo}>
                      <div className={styles.avatar}>
                        {user.avatarUrl ? (
                          <Image
                            src={user.avatarUrl}
                            alt={user.name}
                            width={32}
                            height={32}
                            className={styles.avatarImage}
                          />
                        ) : (
                          <div className={styles.avatarFallback}>
                            {(user.name.charAt(0) || user.email.charAt(0)).toUpperCase()}
                          </div>
                        )}
                        {!user.isPending && <div className={styles.statusDot}></div>}
                      </div>
                      <div className={styles.userDetails}>
                        <div className={`${styles.userName} flex items-center gap-2`}>
                          {user.email}
                          {user.isPending && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xl bg-[#EBF4FF] text-[#3182CE] tracking-wide">
                              Pending
                            </span>
                          )}
                        </div>
                        <div className={styles.userRole}>{user.jobTitle}</div>
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
                  </TableCell>

                  {/* Kebab action cell — always visible */}
                  <TableCell className="text-right pr-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-slate-400"
                          aria-label="More options"
                          title="More options"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="5" r="1.5" />
                            <circle cx="12" cy="12" r="1.5" />
                            <circle cx="12" cy="19" r="1.5" />
                          </svg>
                        </button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end" className="min-w-[160px]">
                        {user.isPending ? (
                          /* ── Pending invite actions ── */
                          <DropdownMenuItem
                            variant="destructive"
                            className="cursor-pointer"
                            onSelect={() => setRevokeTarget({ id: user.id, email: user.email })}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="12" r="10" />
                              <line x1="15" y1="9" x2="9" y2="15" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                            Revoke Invite
                          </DropdownMenuItem>
                        ) : (
                          /* ── Active staff actions ── */
                          <>
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onSelect={() => router.push(`/dashboard/staff/${user.id}`)}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View Profile
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="cursor-pointer"
                              disabled={exportingUserId === user.id}
                              onSelect={() => handleExportPdf(user.id)}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                              </svg>
                              {exportingUserId === user.id ? 'Exporting…' : 'Export PDF'}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              variant="destructive"
                              className="cursor-pointer"
                              onSelect={() =>
                                setRemoveTarget({ id: user.id, name: user.name, email: user.email })
                              }
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <line x1="23" y1="11" x2="17" y2="11" />
                              </svg>
                              Remove Staff
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="text-center p-[60px] text-slate-500">
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-slate-300">
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                      </svg>
                    </div>
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
        <div className={styles.pagination}>
          <div className={styles.paginationInfo}>
            Showing {totalEntries === 0 ? 0 : startIndex + 1} to{' '}
            {Math.min(startIndex + itemsPerPage, totalEntries)} of {totalEntries} entries
          </div>

          <div className={styles.paginationCenter}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </Button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <Button
                key={page}
                variant={page === currentPage ? 'primary' : 'ghost'}
                size="icon-sm"
                onClick={() => handlePageChange(page)}
              >
                {page}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="icon-sm"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </Button>
          </div>

          <div className={styles.paginationRight}>
            Show
            <Select
              value={itemsPerPage.toString()}
              onChange={(value) => {
                setItemsPerPage(Number(value));
                setCurrentPage(1);
              }}
              options={[
                { label: '5', value: '5' },
                { label: '10', value: '10' },
                { label: '20', value: '20' },
              ]}
              size="sm"
              direction="up"
              className={styles.entriesSelect}
            />
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

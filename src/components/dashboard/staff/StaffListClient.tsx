'use client';

import React, { useState, useMemo } from 'react';
import styles from './StaffList.module.css';
import { Button, Input, Select } from '@/components/ui';
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

interface StaffListClientProps {
  users: StaffEntry[];
  hasOrganization: boolean;
  organizationId: string;
}

export default function StaffListClient({
  users: initialUsers,
  hasOrganization,
  organizationId,
}: StaffListClientProps) {
  const [showFeatureGate, setShowFeatureGate] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
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

  // Filter Logic
  // ⚡ Bolt: Memoize filtered users to avoid re-evaluating on every re-render (e.g. pagination or modal state changes).
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

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>Staff Details</h1>
          <p className={styles.subtitle}>Here is an overview of your staff details</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!hasOrganization) {
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
              setCurrentPage(1); // Reset to page 1 on search
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
                style={{ color: '#A0AEC0' }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            }
          />
        </div>

        {/* Table */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '70%', paddingLeft: '24px' }}>Name</th>
              <th style={{ width: '30%', textAlign: 'right', paddingRight: '24px' }}>
                Date Invited
              </th>
            </tr>
          </thead>
          <tbody>
            {currentUsers.length > 0 ? (
              currentUsers.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => !user.isPending && router.push(`/dashboard/staff/${user.id}`)}
                  className={user.isPending ? undefined : styles.clickableRow}
                  style={user.isPending ? { cursor: 'default', opacity: 0.85 } : undefined}
                >
                  <td style={{ paddingLeft: '24px' }}>
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
                        <div
                          className={styles.userName}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          {user.email}
                          {user.isPending && (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: '#EBF4FF',
                                color: '#3182CE',
                                letterSpacing: '0.3px',
                              }}
                            >
                              Pending
                            </span>
                          )}
                        </div>
                        <div className={styles.userRole}>{user.jobTitle}</div>
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      color: '#718096',
                      paddingRight: '24px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {user.isPending ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                        <span>{getRelativeTime(user.dateInvited)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRevokeTarget({ id: user.id, email: user.email });
                          }}
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#E53E3E',
                            background: 'transparent',
                            border: '1px solid #E53E3E',
                            borderRadius: '6px',
                            padding: '3px 10px',
                            cursor: 'pointer',
                            lineHeight: 1.5,
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
                        <span>{getRelativeTime(user.dateInvited)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemoveTarget({ id: user.id, name: user.name, email: user.email });
                          }}
                          style={{
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#E53E3E',
                            background: 'transparent',
                            border: '1px solid #E53E3E',
                            borderRadius: '6px',
                            padding: '3px 10px',
                            cursor: 'pointer',
                            lineHeight: 1.5,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} style={{ textAlign: 'center', padding: '60px', color: '#718096' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* Empty state icon */}
                    <div style={{ color: '#CBD5E0' }}>
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
                    <p style={{ fontSize: '16px', fontWeight: 600, color: '#2D3748' }}>
                      No staff members found
                    </p>
                    <p style={{ fontSize: '14px', color: '#718096' }}>
                      Get started by adding a new staff member to your organization.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>

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
    </div>
  );
}

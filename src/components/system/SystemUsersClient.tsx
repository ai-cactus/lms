'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getAllUsers, getUserDeletePreview } from '@/app/actions/system-admin';
import type { SystemUserRow, DeletePreview } from '@/app/actions/system-admin';
import DeleteUserModal from './DeleteUserModal';
import Link from 'next/link';
import styles from '@/app/system/system.module.css';

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
      console.error('Failed to fetch users:', err);
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
      console.error('Failed to load delete preview:', err);
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
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>All Users</h1>
          <p className={styles.pageDescription}>
            Manage all users across all organizations. {total} total users.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.statsBar}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{total}</div>
          <div className={styles.statLabel}>Total Users</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#2563eb' }}>
            {adminCount}
          </div>
          <div className={styles.statLabel}>Admins (this page)</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#4338ca' }}>
            {workerCount}
          </div>
          <div className={styles.statLabel}>Workers (this page)</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#64748b' }}>
            {organizations.length}
          </div>
          <div className={styles.statLabel}>Organizations</div>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearchSubmit} className={styles.filtersBar}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className={styles.searchInput}
        />
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className={styles.filterSelect}
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
          className={styles.filterSelect}
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
      <div className={styles.tableWrapper}>
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            Loading users...
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>👥</div>
            <div className={styles.emptyStateTitle}>No users found</div>
            <div className={styles.emptyStateText}>
              Try adjusting your search or filter criteria.
            </div>
          </div>
        )}

        {!loading && users.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Organization</th>
                <th>Courses</th>
                <th>Enrollments</th>
                <th>Documents</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className={styles.userCell}>
                      <div className={styles.avatar}>{getInitials(user)}</div>
                      <div>
                        <div className={styles.userName}>{getDisplayName(user)}</div>
                        <div className={styles.userEmail}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`${styles.roleBadge} ${user.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeWorker}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td>{user.organizationName || <span style={{ color: '#94a3b8' }}>None</span>}</td>
                  <td>{user._count.courses}</td>
                  <td>{user._count.enrollments}</td>
                  <td>{user._count.documents}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Link href={`/system/users/${user.id}`} className={styles.viewButton}>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
                      </Link>
                      <button
                        onClick={() => handleDeleteClick(user.id)}
                        disabled={deleteLoading}
                        className={styles.deleteButton}
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
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className={styles.pagination}>
            <div className={styles.paginationInfo}>
              Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} users
            </div>
            <div className={styles.paginationControls}>
              <button
                className={styles.pageButton}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                if (pageNum > totalPages || pageNum < 1) return null;
                return (
                  <button
                    key={pageNum}
                    className={`${styles.pageButton} ${pageNum === page ? styles.pageButtonActive : ''}`}
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                className={styles.pageButton}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      {deletePreview && (
        <DeleteUserModal preview={deletePreview} onClose={() => setDeletePreview(null)} />
      )}
    </>
  );
}

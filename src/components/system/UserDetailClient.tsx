'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { getUserDeletePreview } from '@/app/actions/system-admin';
import type { SystemUserDetail, DeletePreview } from '@/app/actions/system-admin';
import DeleteUserModal from './DeleteUserModal';
import styles from '@/app/system/system.module.css';

interface UserDetailClientProps {
  user: SystemUserDetail;
}

export default function UserDetailClient({ user }: UserDetailClientProps) {
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
      console.error('Failed to load delete preview:', err);
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

  function getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'published':
        return styles.statusBadgePublished;
      case 'draft':
        return styles.statusBadgeDraft;
      default:
        return styles.statusBadgeDefault;
    }
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

  return (
    <>
      {/* Back Link */}
      <div className={styles.detailNav}>
        <Link href="/system" className={styles.backLink}>
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
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Users
        </Link>
      </div>

      {/* Profile Header */}
      <div className={styles.profileHeader}>
        <div className={styles.profileAvatar}>{initials}</div>
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>{displayName}</div>
          <div className={styles.profileEmail}>{user.email}</div>
          <div className={styles.profileMeta}>
            <span
              className={`${styles.roleBadge} ${user.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeWorker}`}
            >
              {user.role}
            </span>
            <span className={styles.statusBadgeDefault} style={{ fontSize: '12px' }}>
              {user.authProvider}
            </span>
            {user.emailVerified ? (
              <span
                style={{
                  fontSize: '12px',
                  color: '#166534',
                  background: '#dcfce7',
                  padding: '4px 10px',
                  borderRadius: '6px',
                }}
              >
                ✓ Verified
              </span>
            ) : (
              <span
                style={{
                  fontSize: '12px',
                  color: '#92400e',
                  background: '#fef3c7',
                  padding: '4px 10px',
                  borderRadius: '6px',
                }}
              >
                Unverified
              </span>
            )}
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Joined {formatDate(user.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Detail Cards Grid */}
      <div className={styles.detailGrid}>
        {/* Organization Card */}
        <div className={styles.detailCard}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Organization</h3>
          </div>
          {user.organization ? (
            <div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Name</span>
                <span className={styles.detailValue}>{user.organization.name}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Slug</span>
                <span className={styles.detailValue}>{user.organization.slug}</span>
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No organization assigned</div>
          )}
        </div>

        {/* Profile Card */}
        <div className={styles.detailCard}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Profile</h3>
          </div>
          {user.profile ? (
            <div>
              {user.profile.jobTitle && (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Job Title</span>
                  <span className={styles.detailValue}>{user.profile.jobTitle}</span>
                </div>
              )}
              {user.profile.companyName && (
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Company</span>
                  <span className={styles.detailValue}>{user.profile.companyName}</span>
                </div>
              )}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Last Updated</span>
                <span className={styles.detailValue}>{formatDate(user.updatedAt)}</span>
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No profile created</div>
          )}
        </div>

        {/* Activity Summary Card */}
        <div className={styles.detailCard}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Activity Summary</h3>
          </div>
          <div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Courses Created</span>
              <span className={styles.detailValue}>{user._count.courses}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Enrollments</span>
              <span className={styles.detailValue}>{user._count.enrollments}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Documents</span>
              <span className={styles.detailValue}>{user._count.documents}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Notifications</span>
              <span className={styles.detailValue}>{user._count.notifications}</span>
            </div>
          </div>
        </div>

        {/* Courses Created */}
        <div className={`${styles.detailCard} ${styles.detailCardFull}`}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Courses Created</h3>
            <span className={styles.detailCardCount}>{user.courses.length}</span>
          </div>
          {user.courses.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Lessons</th>
                  <th>Enrollments</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {user.courses.map((course) => (
                  <tr key={course.id}>
                    <td style={{ fontWeight: 500 }}>{course.title}</td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${getStatusBadgeClass(course.status)}`}
                      >
                        {course.status}
                      </span>
                    </td>
                    <td>{course._count.lessons}</td>
                    <td>{course._count.enrollments}</td>
                    <td>{formatDate(course.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No courses created</div>
          )}
        </div>

        {/* Enrollments */}
        <div className={`${styles.detailCard} ${styles.detailCardFull}`}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Enrollments</h3>
            <span className={styles.detailCardCount}>{user.enrollments.length}</span>
          </div>
          {user.enrollments.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Score</th>
                  <th>Started</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {user.enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td style={{ fontWeight: 500 }}>{enrollment.course.title}</td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${getStatusBadgeClass(enrollment.status)}`}
                      >
                        {enrollment.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            flex: 1,
                            height: '6px',
                            background: '#e2e8f0',
                            borderRadius: '3px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${enrollment.progress}%`,
                              height: '100%',
                              background: enrollment.progress === 100 ? '#22c55e' : '#3b82f6',
                              borderRadius: '3px',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '12px', color: '#64748b', minWidth: '32px' }}>
                          {enrollment.progress}%
                        </span>
                      </div>
                    </td>
                    <td>{enrollment.score !== null ? `${enrollment.score}%` : '—'}</td>
                    <td>{formatDate(enrollment.startedAt)}</td>
                    <td>{enrollment.completedAt ? formatDate(enrollment.completedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No enrollments</div>
          )}
        </div>

        {/* Documents */}
        <div className={`${styles.detailCard} ${styles.detailCardFull}`}>
          <div className={styles.detailCardHeader}>
            <h3 className={styles.detailCardTitle}>Documents</h3>
            <span className={styles.detailCardCount}>{user.documents.length}</span>
          </div>
          {user.documents.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Original Name</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {user.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td style={{ fontWeight: 500 }}>{doc.originalName}</td>
                    <td>{formatSize(doc.size)}</td>
                    <td>{formatDateTime(doc.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '14px' }}>No documents</div>
          )}
        </div>
      </div>

      {/* Delete Section */}
      <div className={styles.deleteSection}>
        <div className={styles.deleteSectionTitle}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Danger Zone
        </div>
        <p className={styles.deleteSectionText}>
          Permanently delete this user and all associated records including courses, enrollments,
          documents, notifications, and profile data. This action cannot be undone.
        </p>
        <button
          onClick={handleDeleteClick}
          disabled={deleteLoading}
          className={styles.deleteButtonLarge}
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
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {deleteLoading ? 'Loading...' : 'Delete This User'}
        </button>
      </div>

      {/* Delete Modal */}
      {deletePreview && (
        <DeleteUserModal preview={deletePreview} onClose={() => setDeletePreview(null)} />
      )}
    </>
  );
}

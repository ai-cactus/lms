'use client';

import React, { useState } from 'react';
import { deleteUserWithRelations } from '@/app/actions/system-admin';
import type { DeletePreview } from '@/app/actions/system-admin';
import { useRouter } from 'next/navigation';
import styles from '@/app/system/system.module.css';

interface DeleteUserModalProps {
  preview: DeletePreview;
  onClose: () => void;
}

export default function DeleteUserModal({ preview, onClose }: DeleteUserModalProps) {
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const emailMatches = confirmEmail === preview.user.email;

  async function handleDelete() {
    if (!emailMatches) return;
    setLoading(true);
    setError('');

    try {
      const result = await deleteUserWithRelations(preview.user.id);
      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push('/system');
          router.refresh();
        }, 2000);
      } else {
        setError(result.error || 'Failed to delete user');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  const { user, counts, affectedEnrollments } = preview;

  const impactRows = [
    { label: 'User Account', count: 1 },
    { label: 'Profile', count: counts.profile },
    { label: 'Courses Created', count: counts.courses },
    { label: 'Lessons (in courses)', count: counts.lessons },
    { label: 'Quizzes (in courses)', count: counts.quizzes },
    { label: 'Enrollments', count: counts.enrollments },
    { label: 'Quiz Attempts', count: counts.quizAttempts },
    { label: 'Documents', count: counts.documents },
    { label: 'Notifications', count: counts.notifications },
    { label: 'Jobs', count: counts.jobs },
    { label: 'Invites', count: counts.invites },
    { label: 'Verification Tokens', count: counts.verificationTokens },
  ].filter((row) => row.count > 0);

  if (success) {
    return (
      <div className={styles.modalOverlay} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modal}>
          <div className={styles.modalBody}>
            <div className={styles.successMessage}>
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
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              User <strong>{user.email}</strong> has been permanently deleted with all related
              records. Redirecting...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            <span style={{ color: '#dc2626' }}>⚠️</span> Delete User Permanently
          </h2>
          <p className={styles.modalSubtitle}>
            This action cannot be undone. All related data will be permanently removed.
          </p>
        </div>

        <div className={styles.modalBody}>
          {error && <div className={styles.errorMessage}>{error}</div>}

          {/* User Info */}
          <div
            style={{
              padding: '12px 16px',
              background: '#f8fafc',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
              {user.name}
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>{user.email}</div>
            <div style={{ marginTop: '4px' }}>
              <span
                className={`${styles.roleBadge} ${user.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeWorker}`}
              >
                {user.role}
              </span>
            </div>
          </div>

          {/* Affected enrollments warning */}
          {affectedEnrollments > 0 && (
            <div
              style={{
                padding: '12px 16px',
                background: '#fef3c7',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#92400e',
              }}
            >
              ⚠️ <strong>{affectedEnrollments}</strong> enrollment(s) from other users in courses
              created by this user will also be deleted.
            </div>
          )}

          {/* Impact Table */}
          <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
            Records to be deleted:
          </h4>
          <table className={styles.impactTable}>
            <thead>
              <tr>
                <th>Record Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {impactRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700 }}>Total Records</td>
                <td style={{ fontWeight: 700 }}>
                  {impactRows.reduce((sum, row) => sum + row.count, 0)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Confirm by typing email */}
          <div className={styles.confirmSection}>
            <p className={styles.confirmLabel}>
              To confirm deletion, type the email address below:
              <span className={styles.confirmCode}>{user.email}</span>
            </p>
            <input
              type="text"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={`Type ${user.email} to confirm`}
              className={styles.confirmInput}
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.cancelButton} disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!emailMatches || loading}
            className={styles.confirmDeleteButton}
          >
            {loading ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import styles from './StaffList.module.css';
import { Button } from '@/components/ui';
import { removeStaff } from '@/app/actions/staff';
import { useRouter } from 'next/navigation';

interface RemoveStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffId: string;
  staffName: string;
  staffEmail: string;
}

export default function RemoveStaffModal({
  isOpen,
  onClose,
  staffId,
  staffName,
  staffEmail,
}: RemoveStaffModalProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!isOpen) return null;

  const handleRemove = async () => {
    setIsRemoving(true);
    setError(null);
    try {
      const result = await removeStaff(staffId);
      if (result.success) {
        onClose();
        router.refresh();
      } else {
        setError(result.error || 'Failed to remove staff member');
      }
    } catch (err) {
      setError('An unexpected error occurred');
      console.error(err);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Remove Staff Member</h2>
          <button className={styles.closeButton} onClick={onClose}>
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.modalDescription}>
            Are you sure you want to remove <strong>{staffName || staffEmail}</strong> from your
            organization?
          </p>
          <p
            className={styles.modalDescription}
            style={{ marginTop: '12px', fontSize: '13px', color: '#E53E3E' }}
          >
            This action will disconnect the user from your organization. They will no longer be able
            to access assigned courses or your organization&apos;s dashboard.
          </p>
          {error && <div className={styles.errorMessage}>{error}</div>}
        </div>

        <div className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose} disabled={isRemoving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleRemove}
            loading={isRemoving}
            style={{ backgroundColor: '#E53E3E', borderColor: '#E53E3E' }}
          >
            Remove Staff
          </Button>
        </div>
      </div>
    </div>
  );
}

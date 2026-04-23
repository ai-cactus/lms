'use client';

import { useRouter } from 'next/navigation';
import styles from './BadgeSuccessModal.module.css';
import { Modal, Button } from '@/components/ui';

interface BadgeSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseName: string;
  organizationName: string;
  badgeId?: string;
  issuedDate: string;
  courseId?: string; // Optional for navigation
}

export default function BadgeSuccessModal({
  isOpen,
  onClose,
  courseName,
  organizationName,
  badgeId = 'LMS-104',
  issuedDate,
  courseId,
}: BadgeSuccessModalProps) {
  const router = useRouter();

  const handleDashboard = () => {
    if (courseId) {
      router.push(`/worker/courses/${courseId}`);
    } else {
      router.push('/worker');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" className={styles.modalParams}>
      <div className={styles.container}>
        <div className={styles.leftPanel}>
          <div className={styles.badgeIcon}>
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="#F6E05E"
                stroke="#D69E2E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 17.77V2"
                stroke="#D69E2E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="4 4"
              />
            </svg>
            <div className={styles.ribbon} />
          </div>

          <h2 className={styles.title}>{`Well done! You've earned a certificate!`}</h2>

          <p className={styles.description}>
            The attestation is now securely stored and accessible on your dashboard anytime.
          </p>

          <div className={styles.badgeCard}>
            <div className={styles.badgeHeader}>
              <h3 className={styles.badgeTitle}>{courseName}</h3>
              <svg
                className={styles.verifiedIcon}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <div className={styles.badgeDetails}>
              <div>{organizationName}</div>
              <div>Issued on: {issuedDate}</div>
              <div>Certificate ID: {badgeId}</div>
            </div>
          </div>

          <Button
            variant="primary"
            fullWidth
            className={styles.dashboardBtn}
            onClick={handleDashboard}
          >
            View Course Status
          </Button>

          <div className={styles.startNewLink}>
            or{' '}
            <span
              className={styles.startNewSpan}
              onClick={() => router.push('/worker')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && router.push('/worker')}
            >
              start a new course here
            </span>
          </div>
        </div>

        <div className={styles.rightPanel}>
          {/* Purple gradient background with confetti/shapes */}
          <div className={styles.shape1} />
          <div className={styles.shape2} />
          <div className={styles.shape3} />

          <div className={styles.floatingBadge}>
            <svg
              width="80"
              height="80"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="#FFD700"
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
          </div>
        </div>
      </div>
    </Modal>
  );
}

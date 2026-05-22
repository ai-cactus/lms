'use client';

import Link from 'next/link';
import styles from './CoursesList.module.css';

interface CoursesBillingGateProps {
  onClose: () => void;
}

export default function CoursesBillingGate({ onClose }: CoursesBillingGateProps) {
  return (
    /* Backdrop — clicking outside closes the dialog */
    <div
      className={styles.billingGateOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="courses-billing-gate-title"
      onClick={onClose}
    >
      <div
        className={styles.billingGateDialog}
        /* Prevent clicks inside the dialog from bubbling to the backdrop */
        onClick={(e) => e.stopPropagation()}
      >
        {/* Illustration */}
        <div className={styles.billingGateIllustration}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            {/* Lock body */}
            <rect x="10" y="22" width="28" height="20" rx="4" fill="#C7D2FE" />
            {/* Lock shackle */}
            <path
              d="M16 22V16a8 8 0 0 1 16 0v6"
              stroke="#4731F7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Keyhole */}
            <circle cx="24" cy="32" r="3" fill="#4731F7" />
            <rect x="23" y="33" width="2" height="4" rx="1" fill="#4731F7" />
          </svg>
        </div>

        {/* Close button */}
        <button className={styles.billingGateClose} onClick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h2 id="courses-billing-gate-title" className={styles.billingGateTitle}>
          Billing required to create courses
        </h2>
        <p className={styles.billingGateDesc}>
          Subscribe to a plan to start creating and managing training courses for your organization.
        </p>

        <div className={styles.billingGateActions}>
          <Link href="/dashboard/billing" className={styles.billingGateCta}>
            Enable Billing
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <button className={styles.billingGateCancel} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import styles from './auditor-pack.module.css';

export default function AuditorBillingGate() {
  return (
    <div className={styles.billingGate}>
      <div className={styles.billingIllustration}>
        {/* Search/document illustration */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="8" y="12" width="28" height="6" rx="3" fill="#C7D2FE" />
          <rect x="8" y="24" width="22" height="6" rx="3" fill="#C7D2FE" />
          <circle cx="38" cy="28" r="8" stroke="#4731F7" strokeWidth="2.5" fill="none" />
          <line
            x1="44.2"
            y1="34.2"
            x2="48"
            y2="38"
            stroke="#4731F7"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className={styles.billingTitle}>Billing required for reports</h2>
      <p className={styles.billingDesc}>Subscribe to a plan to generate auditor packs.</p>
      <Link href="/dashboard/billing" className={styles.billingCta}>
        Select a plan
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </div>
  );
}

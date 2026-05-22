import React from 'react';
import Link from 'next/link';
import styles from './InspectorsActions.module.css';

export default function InspectorsActions() {
  return (
    <div className={styles.inspectorsActions}>
      <Link href="/signup" className={styles.btnPrimary}>
        Start for free &rarr;
      </Link>
      <Link href="/request-demo" className={styles.btnSecondary}>
        Request Demo
      </Link>
    </div>
  );
}
